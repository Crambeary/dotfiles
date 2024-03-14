require('marc.remap')
require('marc.set')
require('marc.command')
require('marc.packer')

-- Set Vim-AsciiDoctor to handle syntax highlighting for .adoc files
vim.cmd('autocmd BufRead,BufNewFile *.adoc setfiletype vim-asciidoctor')
