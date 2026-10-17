import { describe, expect, it } from 'vitest'
import { contentsPages } from '../src/compliance-report-outline.js'
import { outlinePages } from '../src/pdf-outline.js'

// The object syntax Chromium writes: a catalog, a nested page tree, and bookmarks pointing at pages.
const pdf: string = [
  '1 0 obj\n<</Type /Catalog\n/Pages 2 0 R\n/Outlines 9 0 R>>\nendobj',
  '2 0 obj\n<</Type /Pages\n/Count 3\n/Kids [3 0 R 4 0 R]>>\nendobj',
  '3 0 obj\n<</Type /Page\n/Parent 2 0 R>>\nendobj',
  '4 0 obj\n<</Type /Pages\n/Count 2\n/Kids [5 0 R 6 0 R]>>\nendobj',
  '5 0 obj\n<</Type /Page\n/Length 4>>\nstream\n/Title (not a bookmark) endstream\nendobj',
  '6 0 obj\n<</Type /Page>>\nendobj',
  '10 0 obj\n<</Title (1.Vulnerabilities)\n/Dest [5 0 R /XYZ 0 0 0]>>\nendobj',
  '11 0 obj\n<</Title (1.2.Mitigation plans)\n/Dest [6 0 R /XYZ 0 0 0]>>\nendobj',
  '12 0 obj\n<</Title <FEFF0032002E004C>\n/Dest [3 0 R /XYZ 0 0 0]>>\nendobj',
  '13 0 obj\n<</Title (Escaped \\(paren\\) \\101 \\n)\n/Dest [6 0 R /XYZ 0 0 0]>>\nendobj',
  '14 0 obj\n<</Title (Nowhere)\n/Dest [99 0 R /XYZ 0 0 0]>>\nendobj',
].join('\n')

describe('PDF outline pages', () => {
  it('maps each bookmark to the page its destination is, in page-tree order', () => {
    expect([...outlinePages(pdf)]).toEqual([
      ['1.Vulnerabilities', 2],
      ['1.2.Mitigation plans', 3],
      ['2.L', 1],
      ['Escaped (paren) A \n', 3],
    ])
  })
  it('yields nothing for a document without a recognised page tree', () => {
    expect(outlinePages('%PDF-1.7 nothing here')).toEqual(new Map())
  })
  it('numbers the contents by matching each heading to its bookmark', () => {
    expect([...contentsPages(outlinePages(pdf))]).toEqual([
      ['vulnerabilities', 2],
      ['advisories-plans', 3],
    ])
  })
})
