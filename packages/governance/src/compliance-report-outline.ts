// The report's numbered outline: one definition that both the headings and the table of contents read,
// so a section can never be numbered one way in the text and another in the contents.

/** A numbered subsection of the report. */
interface OutlineEntry {
  readonly id: string
  readonly title: string
}

/** A numbered section of the report and its subsections. */
interface OutlineSection extends OutlineEntry {
  readonly subsections: readonly OutlineEntry[]
}

const OUTLINE: readonly OutlineSection[] = [
  {
    id: 'vulnerabilities',
    title: 'Vulnerabilities',
    subsections: [
      { id: 'advisories-all', title: 'All vulnerabilities' },
      { id: 'advisories-plans', title: 'Mitigation plans' },
      { id: 'advisories-stale', title: 'Recorded mitigations without a vulnerability' },
    ],
  },
  {
    id: 'licenses',
    title: 'Licenses',
    subsections: [
      { id: 'license-classes', title: 'License classes' },
      { id: 'common-licenses', title: 'Most common licenses' },
      { id: 'review-weak-copyleft', title: 'Weak copyleft packages' },
      { id: 'review-outside', title: 'Packages outside the policy' },
    ],
  },
  {
    id: 'policy',
    title: 'License policy',
    subsections: [
      { id: 'policy-permissive', title: 'Permissive licenses' },
      { id: 'policy-weak-copyleft', title: 'Weak copyleft licenses' },
      { id: 'policy-outside', title: 'Licenses outside the policy' },
    ],
  },
  { id: 'inventory', title: 'Package inventory', subsections: [] },
  {
    id: 'notices',
    title: 'Third-party notices',
    subsections: [
      { id: 'notices-missing', title: 'Packages without a license file' },
      { id: 'notices-texts', title: 'License texts' },
    ],
  },
  {
    id: 'provenance',
    title: 'Provenance and reproduction',
    subsections: [
      { id: 'provenance-source', title: 'Source' },
      { id: 'provenance-scope', title: 'Scope' },
    ],
  },
]

interface Numbered {
  readonly number: string
  readonly title: string
}

const NUMBERED: ReadonlyMap<string, Numbered> = new Map(
  OUTLINE.flatMap((section: OutlineSection, index: number): readonly (readonly [string, Numbered])[] => {
    const number: string = String(index + 1)
    return [
      [section.id, { number, title: section.title }],
      ...section.subsections.map((entry: OutlineEntry, position: number): readonly [string, Numbered] => [
        entry.id,
        { number: `${number}.${String(position + 1)}`, title: entry.title },
      ]),
    ]
  }),
)

const numberedOf = (id: string): Numbered => {
  const found: Numbered | undefined = NUMBERED.get(id)
  if (found === undefined) {
    throw new Error(`the report outline has no entry "${id}"`)
  }
  return found
}

const headingText = (entry: Numbered): string =>
  `<span class="adnum">${entry.number}.</span><span class="adtext">${entry.title}</span>`

/**
 * A numbered subsection heading.
 * @param id the outline entry.
 * @returns the heading element.
 */
export const subheading = (id: string): string => `<h3 id="${id}">${headingText(numberedOf(id))}</h3>`

/**
 * A numbered top-level section.
 * @param id the outline section.
 * @param body the section's markup after its heading.
 * @returns the section element.
 */
export const section = (id: string, body: string): string =>
  `<section class="sect1" id="${id}" aria-labelledby="${id}-title">` +
  `<h2 id="${id}-title">${headingText(numberedOf(id))}</h2>${body}</section>`

// The leader and page slots are filled only in print, where the contents list carries page numbers.
const tocLink = (id: string): string =>
  `<a href="#${id}">${headingText(numberedOf(id))}<span class="leader"></span><span class="page" data-for="${id}">` +
  '</span></a>'

/**
 * The table of contents, read from the same outline as the headings. It lists the sections only, so it
 * stays short enough to share the first page with the verdict.
 * @returns the contents navigation.
 */
export const tableOfContents = (): string =>
  '<nav id="toc" aria-labelledby="toctitle"><div id="toctitle">Contents</div><ul class="sectlevel1">' +
  OUTLINE.map((entry: OutlineSection): string => `<li>${tocLink(entry.id)}</li>`).join('') +
  '</ul></nav>'

/**
 * The cross-reference text for a section, such as "section 3".
 * @param id the outline entry.
 * @returns the reference text.
 */
export const sectionReference = (id: string): string => `section ${numberedOf(id).number}`

/**
 * The page of every outline entry, from the bookmarks of a printed report. A bookmark is titled with the
 * heading's text, which starts with the entry's number, so the number is what is matched.
 * @param bookmarks the page by bookmark title, as read from the PDF.
 * @returns the page number by outline id, for every entry found.
 */
export const contentsPages = (bookmarks: ReadonlyMap<string, number>): ReadonlyMap<string, number> =>
  new Map(
    [...NUMBERED].flatMap(([id, entry]: readonly [string, Numbered]): readonly (readonly [string, number])[] => {
      const page: number | undefined = [...bookmarks].find(([title]: readonly [string, number]): boolean =>
        title.startsWith(`${entry.number}.${entry.title}`),
      )?.[1]
      return page === undefined ? [] : [[id, page]]
    }),
  )
