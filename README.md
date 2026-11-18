# dropslop (command line)

Check markdown and text files for phrases that read machine-made.

    npx github:tynskid/dropslop-cli check README.md posts/*.md
    npx github:tynskid/dropslop-cli check posts/*.md --threshold 85     # exit 1 if any file scores under 85% human (for CI)
    npx github:tynskid/dropslop-cli check draft.md --cuts               # with a suggested replacement for each flagged phrase

Each file is one check on DropSlop. Without a key it uses the free checks anyone gets (three a day); set `DROPSLOP_API_KEY`
(from https://dropslop.ai/keys/) to use your plan's allowance. Front matter, code blocks and inline code are left
out. Node 18 or later, no dependencies.

The score is an estimate for the whole file and can be wrong about any one text.

Not on npm yet: the commands above run it straight from this repository. From a clone: `node bin/dropslop.js check <file>`.

MIT licence. Made by DropSlop, https://dropslop.ai/
