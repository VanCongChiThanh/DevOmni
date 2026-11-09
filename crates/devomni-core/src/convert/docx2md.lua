-- DevOmni: shape a Word document into clean, portable Markdown.
--
-- Pandoc's DOCX reader keeps Word-specific structure that Markdown viewers
-- (VS Code, GitHub, Typora, Obsidian) can't render. This filter fixes it
-- without dropping text:
--
--  * Table cells with several paragraphs / lists are flattened into one line
--    joined by <br> (bullets kept as "•", "1."), so tables become real pipe
--    tables. Tables with merged cells stay HTML tables (still render).
--  * Headerless tables get their first row promoted to the header.
--  * Indented paragraphs (which Pandoc turns into > blockquotes) are unwrapped.
--  * Word's table of contents becomes a nested list of links, without page numbers.
--  * Auto-numbered headings ("I.", "IV.1.2") get their number back, taken from
--    the table of contents (Word keeps the number outside the heading text).
--  * Heading anchors are rewritten to GitHub-style slugs so TOC and
--    cross-reference links work in Markdown previews.
--  * Styling wrappers (small caps, highlight spans, bookmarks, image sizes) are
--    reduced to their content.

local stringify = pandoc.utils.stringify
local BR = function() return pandoc.RawInline("html", "<br>") end

-- Page numbers dropped from the TOC, reported to DevOmni on stderr so its
-- verification step can tell them apart from accidentally lost text.
local REMOVED = {}

-- NOTE: never use %s / %u / %a on text here. With some C locales (Windows)
-- they match bytes >= 0x80 and would cut UTF-8 characters (Vietnamese!) apart.
local function trim(s) return (s:gsub("^[ \t\r\n]+", ""):gsub("[ \t\r\n]+$", "")) end
local function lower(s) return pandoc.text and pandoc.text.lower(s) or s:lower() end

-- ── Table of contents ──────────────────────────────────────────────────────

-- A TOC entry is a paragraph holding one internal link whose text (or the text
-- right after it) ends with a page number. Returns target, clean text.
local function toc_entry(blk)
  if blk.t ~= "Para" and blk.t ~= "Plain" then return nil end
  local link, tail = nil, ""
  for _, el in ipairs(blk.content) do
    if el.t == "Link" and not link then
      link = el
    elseif el.t == "Space" or el.t == "SoftBreak" then
      -- ignore
    elseif el.t == "Str" and link then
      tail = tail .. el.text
    else
      return nil
    end
  end
  if not link or not link.target:match("^#") then return nil end
  local text = trim(stringify(link.content)) .. (tail ~= "" and (" " .. tail) or "")
  local dotted = text:gsub("…", ".") -- plain multi-byte replace, outside a [class]
  local clean = trim((dotted:gsub("[ \t%.]+%d+[ \t]*$", "")))
  if clean == trim(dotted) then clean = text end
  if clean == text or clean == "" then return nil end
  return link.target, clean, text:match("(%d+)[ \t]*$")
end

-- Entries of a block (a TOC paragraph, or a blockquote nesting more of them).
local function toc_entries(blk, depth, out)
  local target, text, page = toc_entry(blk)
  if target then
    table.insert(out, { level = depth, target = target, text = text, page = page })
    return true
  end
  if blk.t == "BlockQuote" then
    for _, b in ipairs(blk.content) do
      if not toc_entries(b, depth + 1, out) then return false end
    end
    return true
  end
  return false
end

local function build_list(entries, i, level)
  local items = {}
  while i <= #entries and entries[i].level >= level do
    local e = entries[i]
    if e.level == level then
      local link = pandoc.Link(e.text, e.target, "", pandoc.Attr("", { "devomni-toc" }))
      table.insert(items, { pandoc.Plain({ link }) })
      i = i + 1
    else
      local sub
      sub, i = build_list(entries, i, e.level)
      if #items == 0 then table.insert(items, {}) end
      table.insert(items[#items], sub)
    end
  end
  return pandoc.BulletList(items), i
end

-- Outline depth from a leading number: "I." → 0, "I.1." → 1, "IV.1.1" → 2,
-- "1.2.3" → 2. Plain "1." is ambiguous, so the indentation decides.
local function outline_level(text)
  local t = text:gsub("^([A-Z]+%.) +(%d)", "%1%2")
  local num = t:match("^([IVXLCDM]+%.[%d%.]*) ") or t:match("^(%d+%.%d[%d%.]*) ")
  if not num then return nil end
  num = num:gsub("%.$", "")
  return select(2, num:gsub("%.", ""))
end

-- Replace runs of TOC blocks with a nested list; return target → TOC text
-- and the list of all TOC texts.
local function rebuild_toc(blocks)
  local out, toc_text, all = pandoc.List(), {}, {}
  local i = 1
  while i <= #blocks do
    local entries, j = {}, i
    while j <= #blocks do
      local tmp = {}
      if not toc_entries(blocks[j], 0, tmp) then break end
      for _, e in ipairs(tmp) do table.insert(entries, e) end
      j = j + 1
    end
    if #entries >= 2 then
      local base = math.huge
      for _, e in ipairs(entries) do base = math.min(base, e.level) end
      local parent = 0
      for _, e in ipairs(entries) do
        local ol = outline_level(e.text)
        if ol then
          e.level = ol
          parent = ol
        else
          -- Unnumbered entry: indentation relative to the TOC, but never
          -- shallower than one level under the last numbered parent if indented.
          local d = e.level - base
          e.level = d > 0 and math.max(d, parent + 1) or 0
        end
        if #e.target > 1 then toc_text[e.target:sub(2)] = e.text end
        if e.page then table.insert(REMOVED, e.page) end
        table.insert(all, e.text)
      end
      out:insert((build_list(entries, 1, 0)))
      i = j
    else
      out:insert(blocks[i])
      i = i + 1
    end
  end
  return out, toc_text, all
end

-- ── Tables ─────────────────────────────────────────────────────────────────

-- Append a cell's blocks to `out` as inlines separated by <br>. Returns false
-- when the cell holds something that can't be one line (a nested table).
local flatten

-- A list item; an empty one still shows its marker (Word numbers empty
-- paragraphs too, e.g. the row numbers of an "STT" column).
local function flatten_item(item, out, depth, prefix)
  local before = #out
  if not flatten(item, out, depth, prefix) then return false end
  if #out == before then
    if #out > 0 then out:insert(BR()) end
    out:insert(pandoc.Str((trim(prefix):gsub("%.$", ""))))
  end
  return true
end

flatten = function(blocks, out, depth, prefix)
  local first = true
  local function line(inlines)
    if #out > 0 then out:insert(BR()) end
    if first and prefix then out:insert(pandoc.Str(prefix)) end
    first = false
    for _, el in ipairs(inlines) do
      if el.t == "LineBreak" then out:insert(BR()) else out:insert(el) end
    end
  end
  for _, b in ipairs(blocks) do
    local t = b.t
    if t == "Para" or t == "Plain" then
      if #b.content > 0 then line(b.content) end
    elseif t == "Header" then
      line({ pandoc.Strong(b.content) })
    elseif t == "BulletList" then
      local mark = string.rep("  ", depth) .. (depth == 0 and "• " or "◦ ")
      for _, item in ipairs(b.content) do
        if not flatten_item(item, out, depth + 1, mark) then return false end
      end
      first = false
    elseif t == "OrderedList" then
      local n = b.listAttributes.start or 1
      for _, item in ipairs(b.content) do
        if not flatten_item(item, out, depth + 1, string.rep("  ", depth) .. n .. ". ") then return false end
        n = n + 1
      end
      first = false
    elseif t == "CodeBlock" then
      for l in (b.text .. "\n"):gmatch("(.-)\n") do line({ pandoc.Code(l) }) end
    elseif t == "LineBlock" then
      for _, l in ipairs(b.content) do line(l) end
    elseif t == "Div" or t == "BlockQuote" or t == "Figure" then
      if not flatten(b.content, out, depth, first and prefix or nil) then return false end
      first = false
    elseif t == "HorizontalRule" or t == "Null" then
      -- nothing to keep
    elseif t == "Table" then
      return false
    else
      line({ pandoc.Str(stringify(b)) })
    end
  end
  return true
end

-- Undo merged cells: Markdown tables have no row/col spans, so a merged cell
-- keeps its content in the first position and the covered positions become
-- empty cells. Without this, Pandoc falls back to an HTML table.
local function unmerge(rows, ncols)
  local pending = {} -- column -> rows still covered by a rowspan above
  local out = {}
  for _, row in ipairs(rows) do
    local cells, new, col, ci = row.cells, {}, 1, 1
    while col <= ncols do
      if (pending[col] or 0) > 0 then
        pending[col] = pending[col] - 1
        new[#new + 1] = pandoc.Cell({})
        col = col + 1
      else
        local c = cells[ci]
        ci = ci + 1
        if not c then
          new[#new + 1] = pandoc.Cell({})
          col = col + 1
        else
          local rs, cs = c.row_span or 1, c.col_span or 1
          c.row_span, c.col_span = 1, 1
          new[#new + 1] = c
          for k = 0, cs - 1 do
            if k > 0 then new[#new + 1] = pandoc.Cell({}) end
            if rs > 1 then pending[col + k] = rs - 1 end
          end
          col = col + cs
        end
      end
    end
    row.cells = new
    out[#out + 1] = row
  end
  return out
end

local function flat_ok(rows)
  for _, row in ipairs(rows) do
    for _, cell in ipairs(row.cells) do
      if not flatten(cell.contents, pandoc.List(), 0, nil) then return false end
    end
  end
  return true
end

local function flat_rows(rows)
  for _, row in ipairs(rows) do
    local cells = {}
    for _, cell in ipairs(row.cells) do
      local out = pandoc.List()
      flatten(cell.contents, out, 0, nil)
      cell.contents = #out > 0 and { pandoc.Plain(out) } or {}
      cells[#cells + 1] = cell
    end
    row.cells = cells
  end
  return rows
end

local function fix_table(tbl)
  local ncols = #tbl.colspecs
  -- Work on plain Lua lists of rows and assign them back explicitly.
  local head = unmerge(tbl.head.rows, ncols)
  local bodies = {}
  for _, body in ipairs(tbl.bodies) do
    bodies[#bodies + 1] = { body = body, head = unmerge(body.head, ncols), rows = unmerge(body.body, ncols) }
  end
  local foot = unmerge(tbl.foot.rows, ncols)

  -- Flatten every cell to one line; if any cell can't be (nested table), keep
  -- the cells as they are and Pandoc writes an HTML table, which still renders.
  local ok = flat_ok(head) and flat_ok(foot)
  for _, b in ipairs(bodies) do ok = ok and flat_ok(b.head) and flat_ok(b.rows) end
  if ok then
    flat_rows(head)
    flat_rows(foot)
    for _, b in ipairs(bodies) do
      flat_rows(b.head)
      flat_rows(b.rows)
    end
  end

  -- Markdown tables need a header row: promote the first row when Word had none.
  if #head == 0 and bodies[1] and #bodies[1].rows > 0 then
    head = { table.remove(bodies[1].rows, 1) }
  end

  tbl.head.rows = head
  local new_bodies = {}
  for _, b in ipairs(bodies) do
    b.body.head = b.head
    b.body.body = b.rows
    new_bodies[#new_bodies + 1] = b.body
  end
  tbl.bodies = new_bodies
  tbl.foot.rows = foot
  return tbl
end

-- ── Slugs (GitHub / VS Code style) ────────────────────────────────────────

local function is_punct(cp)
  return (cp >= 0x2000 and cp <= 0x206F) or (cp >= 0x3000 and cp <= 0x303F) or (cp >= 0xA0 and cp <= 0xBF)
    or cp == 0xD7 or cp == 0xF7
end

local function slug(text)
  local s, out = lower(text), {}
  for _, cp in utf8.codes(s) do
    local ch = utf8.char(cp)
    if cp < 128 then
      if ch:match("[%w_%-]") then out[#out + 1] = ch elseif ch == " " then out[#out + 1] = "-" end
    elseif not is_punct(cp) then
      out[#out + 1] = ch
    end
  end
  return table.concat(out)
end

-- ── Main ───────────────────────────────────────────────────────────────────

local MARK = "\u{2063}" -- placed by DevOmni into empty auto-numbered paragraphs

local function is_space(x) return x.t == "Space" or x.t == "SoftBreak" end

-- "**label: **" is not bold in CommonMark (closing ** after a space) and shows
-- the asterisks literally. Move edge spaces outside the emphasis.
-- Unicode spaces CommonMark also counts as whitespace (NBSP, thin, narrow NBSP…)
local USPACE = { "\u{00A0}", "\u{2007}", "\u{2009}", "\u{200A}", "\u{202F}", "\u{3000}" }

local function strip_uspace(text, at_end)
  local changed = true
  local hit = false
  while changed do
    changed = false
    local t = at_end and text:gsub("[ \t\r\n]+$", "") or text:gsub("^[ \t\r\n]+", "")
    if t ~= text then text, changed, hit = t, true, true end
    for _, sp in ipairs(USPACE) do
      if at_end and text:sub(-#sp) == sp then
        text, changed, hit = text:sub(1, -#sp - 1), true, true
      elseif not at_end and text:sub(1, #sp) == sp then
        text, changed, hit = text:sub(#sp + 1), true, true
      end
    end
  end
  return text, hit
end

local function edge_spaces(el)
  local c = pandoc.List(el.content)
  local lead, trail = false, false
  local function trim_strs()
    local again = true
    while again and #c > 0 do
      again = false
      if is_space(c[1]) then
        c:remove(1); lead, again = true, true
      elseif c[1].t == "Str" then
        local t, hit = strip_uspace(c[1].text, false)
        if hit then
          lead, again = true, true
          if t == "" then c:remove(1) else c[1] = pandoc.Str(t) end
        end
      end
      if #c > 0 and is_space(c[#c]) then
        c:remove(#c); trail, again = true, true
      elseif #c > 0 and c[#c].t == "Str" then
        local t, hit = strip_uspace(c[#c].text, true)
        if hit then
          trail, again = true, true
          if t == "" then c:remove(#c) else c[#c] = pandoc.Str(t) end
        end
      end
    end
  end
  trim_strs()
  if not lead and not trail then return nil end
  if #c == 0 then return { pandoc.Space() } end
  el.content = c
  local out = {}
  if lead then out[#out + 1] = pandoc.Space() end
  out[#out + 1] = el
  if trail then out[#out + 1] = pandoc.Space() end
  return out
end

-- Word often splits one visual list into several (different numbering ids),
-- which Pandoc separates with "<!-- -->". Join lists that simply continue.
local function merge_lists(blocks)
  local out = pandoc.List()
  for _, b in ipairs(blocks) do
    local prev = out[#out]
    if prev and b.t == "BulletList" and prev.t == "BulletList" then
      prev.content = prev.content .. b.content
    elseif prev and b.t == "OrderedList" and prev.t == "OrderedList"
      and b.listAttributes.start == prev.listAttributes.start + #prev.content then
      prev.content = prev.content .. b.content
    else
      out:insert(b)
    end
  end
  return out
end

local cleanup = {
  Strong = edge_spaces,
  Emph = edge_spaces,
  Underline = edge_spaces,
  Strikeout = edge_spaces,
  Blocks = merge_lists,
  Str = function(el)
    if not el.text:find(MARK, 1, true) then return nil end
    local t = el.text:gsub(MARK, "")
    return t == "" and {} or pandoc.Str(t)
  end,
  Span = function(el) return el.content end,
  SmallCaps = function(el) return el.content end,
  Image = function(el)
    el.attr = pandoc.Attr()
    return el
  end,
  Header = function(el)
    local c = el.content:map(function(x) return x.t == "LineBreak" and pandoc.Space() or x end)
    while #c > 0 and is_space(c[1]) do c:remove(1) end
    while #c > 0 and is_space(c[#c]) do c:remove(#c) end
    el.content = c
    if trim(stringify(el.content)) == "" then return {} end
    return el
  end,
  Para = function(el)
    for _, x in ipairs(el.content) do
      if x.t ~= "Space" and x.t ~= "SoftBreak" and x.t ~= "LineBreak" then return nil end
    end
    return {} -- paragraph with nothing but whitespace / line breaks
  end,
  BlockQuote = function(el) return el.content end,
  Div = function(el) return el.content end,
  Table = fix_table,
}

-- Word paragraphs styled Title / Subtitle / Author / Date / Abstract are moved
-- into metadata by Pandoc, which GFM output doesn't print. Put them back.
local function meta_blocks(meta)
  local out = pandoc.List()
  local function inl(v)
    if v == nil then return nil end
    local t = pandoc.utils.type(v)
    if t == "Inlines" then return v end
    if t == "Blocks" then return pandoc.utils.blocks_to_inlines(v) end
    if t == "string" then return pandoc.Inlines(v) end
    return nil
  end
  local title = inl(meta.title)
  if title and #title > 0 then out:insert(pandoc.Header(1, title)) end
  local sub = inl(meta.subtitle)
  if sub and #sub > 0 then out:insert(pandoc.Para({ pandoc.Emph(sub) })) end
  local authors = meta.author
  if authors ~= nil then
    if pandoc.utils.type(authors) ~= "List" then authors = { authors } end
    for _, a in ipairs(authors) do
      local i = inl(a)
      if i and #i > 0 then out:insert(pandoc.Para(i)) end
    end
  end
  local date = inl(meta.date)
  if date and #date > 0 then out:insert(pandoc.Para(date)) end
  local abstract = meta.abstract
  if abstract ~= nil then
    if pandoc.utils.type(abstract) == "Blocks" then out:extend(abstract)
    else
      local i = inl(abstract)
      if i then out:insert(pandoc.Para(i)) end
    end
  end
  return out
end

function Pandoc(doc)
  doc.blocks = meta_blocks(doc.meta) .. doc.blocks
  local blocks, toc_text, toc_all = rebuild_toc(doc.blocks)
  doc.blocks = blocks

  -- TOC text for a heading: by anchor, else (broken Word bookmark) by a TOC
  -- entry that ends with the heading text after a number.
  local function toc_for(h, cur)
    local t = toc_text[h.identifier]
    if t then return t end
    local lc = lower(cur)
    for _, cand in ipairs(toc_all) do
      local lt = lower(cand)
      if #lt > #lc and lt:sub(-#lc) == lc and outline_level(cand:sub(1, #cand - #cur) .. " ") then
        return cand
      end
    end
    return nil
  end

  -- Give auto-numbered headings their number back (from the TOC text).
  doc = doc:walk({
    Header = function(h)
      local cur = trim(stringify(h.content))
      local t = cur ~= "" and toc_for(h, cur)
      if not t then return nil end
      if lower(t) ~= lower(cur) and lower(t):sub(-#cur) == lower(cur) then
        local prefix = trim(t:sub(1, #t - #cur))
        if prefix ~= "" then
          h.content = pandoc.List({ pandoc.Str(prefix), pandoc.Space() }) .. h.content
        end
      end
      return h
    end,
  })

  doc = doc:walk(cleanup)

  -- Rewrite anchors to the slugs Markdown previewers generate.
  local ids, seen, by_text = {}, {}, {}
  doc = doc:walk({
    Header = function(h)
      local text = trim(stringify(h.content))
      local base = slug(text)
      local s = base
      if seen[base] then s = base .. "-" .. seen[base] end
      seen[base] = (seen[base] or 0) + 1
      if h.identifier ~= "" then ids[h.identifier] = s end
      by_text[lower(text)] = by_text[lower(text)] or s
      h.identifier = s
      return h
    end,
  })
  doc = doc:walk({
    Link = function(l)
      local id = l.target:match("^#(.*)$")
      if not id then return nil end
      if ids[id] then
        l.target = "#" .. ids[id]
      elseif l.classes:includes("devomni-toc") then
        local s = by_text[lower(trim(stringify(l.content)))]
        if s then l.target = "#" .. s end
      end
      l.attr = pandoc.Attr()
      return l
    end,
  })
  if #REMOVED > 0 then io.stderr:write("[devomni:removed] " .. table.concat(REMOVED, " ") .. "\n") end
  return doc
end
