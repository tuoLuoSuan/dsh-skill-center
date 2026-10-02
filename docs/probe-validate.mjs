import { inspectSkillDocument, renameInDocument } from '../lib/validate.js'
const cases = {
  'good': '---\nname: pdf\ndescription: Work with PDF files end to end.\n---\n\n# PDF\nBody here.\n',
  'titlecase': '---\nname: PDF-Processing\ndescription: Work with PDF files end to end.\n---\n\n# PDF\n',
  'underscore': '---\nname: my_pdf_tool\ndescription: handles pdfs\n---\n\n# x\n',
  'no-name': '---\ndescription: Something useful here.\n---\n\n# x\n',
  'no-fm': '# Just a readme\n\nnothing else\n',
  'blank-first': '\n---\nname: pdf\ndescription: Work with PDF files end to end.\n---\n\n# x\n',
  'mismatch': '---\nname: other-name\ndescription: Work with PDF files end to end.\n---\n\n# x\n',
}
for (const [label, raw] of Object.entries(cases)) {
  const r = await inspectSkillDocument(raw, { installName: 'pdf' })
  console.log(`${label.padEnd(12)} blocked=${String(r.blocked).padEnd(5)} repairable=${String(r.repairable).padEnd(5)} install=${r.installName.padEnd(14)} problems=${r.problems.map(p => p.code).join(',') || '-'}`)
}
console.log('\n--- rename round trip (titlecase -> pdf-processing) ---')
const fixed = renameInDocument(cases.titlecase, 'pdf-processing')
console.log(JSON.stringify(fixed))
console.log('re-parsed:', (await inspectSkillDocument(fixed, { installName: 'pdf-processing' })).problems.map(p=>p.code))
