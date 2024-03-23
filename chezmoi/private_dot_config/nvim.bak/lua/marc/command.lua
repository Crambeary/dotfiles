-- Define the function to compile Asciidoctor
local function compileAsciidoctor()
    -- Run the command to compile Asciidoctor
    vim.fn.system('asciidoctor 360-data-format.adoc')
end

-- Set up autocommand to trigger when saving a .adoc file
vim.cmd[[
  augroup AsciidoctorAutoCompile
    autocmd!
    autocmd BufWritePost *.adoc lua compileAsciidoctor()
  augroup END
]]

-- Expose the function to be used in the autocommand
_G.compileAsciidoctor = compileAsciidoctor
