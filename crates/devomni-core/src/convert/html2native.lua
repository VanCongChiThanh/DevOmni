-- DevOmni: turn raw HTML embedded in Markdown into real document elements.
--
-- Pandoc's DOCX writer silently drops raw HTML, but Markdown files (READMEs
-- especially) routinely contain <img>, <br>, <b>…</b>, <sub>, <kbd>, <a><img></a>
-- and whole <table> blocks. Without this filter those images and that text
-- would vanish from the .docx. Unknown/unbalanced tags are left untouched.

local stringify = pandoc.utils.stringify

local function read_html(s)
  local ok, doc = pcall(pandoc.read, s, "html")
  if ok then return doc end
  return nil
end

local function attr(text, name)
  return text:match(name .. '[ \t\r\n]*=[ \t\r\n]*"([^"]*)"') or text:match(name .. "[ \t\r\n]*=[ \t\r\n]*'([^']*)'")
end

-- Paired inline tags → constructor(content, opening tag text)
local wrap = {
  b = function(c) return pandoc.Strong(c) end,
  strong = function(c) return pandoc.Strong(c) end,
  i = function(c) return pandoc.Emph(c) end,
  em = function(c) return pandoc.Emph(c) end,
  u = function(c) return pandoc.Underline(c) end,
  ins = function(c) return pandoc.Underline(c) end,
  s = function(c) return pandoc.Strikeout(c) end,
  del = function(c) return pandoc.Strikeout(c) end,
  strike = function(c) return pandoc.Strikeout(c) end,
  sub = function(c) return pandoc.Subscript(c) end,
  sup = function(c) return pandoc.Superscript(c) end,
  small = function(c) return pandoc.SmallCaps(c) end,
  code = function(c) return pandoc.Code(stringify(c)) end,
  kbd = function(c) return pandoc.Code(stringify(c)) end,
  tt = function(c) return pandoc.Code(stringify(c)) end,
  mark = function(c) return pandoc.Span(c, pandoc.Attr("", { "mark" })) end,
  span = function(c) return pandoc.Span(c) end,
  font = function(c) return pandoc.Span(c) end,
  a = function(c, open)
    local href = attr(open, "href")
    if href then return pandoc.Link(c, href, attr(open, "title") or "") end
    return pandoc.Span(c)
  end,
}

-- Standalone inline tags (<img>, <br>, <hr>…)
local function standalone(el)
  local tag = el.text:match("^<[ \t\r\n]*([A-Za-z]+)")
  if not tag then return nil end
  tag = tag:lower()
  if tag == "br" then return { pandoc.LineBreak() } end
  if tag == "img" then
    local doc = read_html(el.text)
    if doc and doc.blocks[1] then
      local found = {}
      doc.blocks[1]:walk({ Image = function(img) table.insert(found, img) end })
      if #found > 0 then return found end
    end
  end
  return nil
end

function Inlines(inlines)
  local out = pandoc.List()
  local stack = {} -- open tags: { tag, pos, text }

  for _, el in ipairs(inlines) do
    local handled = false
    if el.t == "RawInline" and el.format:match("html") then
      local text = el.text
      local open = text:match("^<[ \t\r\n]*([A-Za-z]+)[^>]*>$")
      local close = text:match("^<[ \t\r\n]*/[ \t\r\n]*([A-Za-z]+)[ \t\r\n]*>$")
      if open and wrap[open:lower()] and not text:match("/[ \t\r\n]*>$") then
        table.insert(stack, { tag = open:lower(), pos = #out + 1, text = text })
        out:insert(el) -- placeholder until the closing tag shows up
        handled = true
      elseif close then
        close = close:lower()
        for k = #stack, 1, -1 do
          if stack[k].tag == close then
            local pos = stack[k].pos
            local content = pandoc.List()
            for j = pos + 1, #out do content:insert(out[j]) end
            for j = #out, pos, -1 do out:remove(j) end
            out:insert(wrap[close](content, stack[k].text))
            for j = #stack, k, -1 do table.remove(stack, j) end
            handled = true
            break
          end
        end
      end
      if not handled then
        local repl = standalone(el)
        if repl then
          out:extend(repl)
          handled = true
        end
      end
    end
    if not handled then out:insert(el) end
  end
  return out
end

function RawBlock(el)
  if not el.format:match("html") then return nil end
  if el.text:match("^[ \t\r\n]*<!%-%-") then return nil end -- comments stay comments
  local doc = read_html(el.text)
  if doc and #doc.blocks > 0 then
    -- Run the inline pass over the parsed HTML too (nested <b>, <img>…).
    return pandoc.Pandoc(doc.blocks):walk({ Inlines = Inlines }).blocks
  end
  return nil
end
