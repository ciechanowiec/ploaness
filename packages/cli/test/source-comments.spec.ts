import { describe, expect, it } from 'vitest'
import { sourceComments } from '../src/source-comments.js'

const DIRECTIVE: string = 'oxlint-disable-next-line jsx-a11y/alt-text -- adapter'

describe('actual source comments', () => {
  it('locates JSX comments once even when several syntax nodes share their trivia', () => {
    const source: string = `export const card = <div>\n{/* ${DIRECTIVE} */}\n<img />\n</div>`
    expect(sourceComments(source)).toEqual([{ line: 2, text: `/* ${DIRECTIVE} */` }])
  })

  it.each([
    `const text = '// ${DIRECTIVE}'`,
    `const text = \`// ${DIRECTIVE}\``,
    `const view = <pre>// ${DIRECTIVE}</pre>`,
    `const view = <pre>/* ${DIRECTIVE} */</pre>`,
    `const text = \`value: \${value}// ${DIRECTIVE}\``,
    'const pattern = /[/*]not-a-comment[/*]/',
  ])('does not interpret source data as a comment: %s', (source) => {
    expect(sourceComments(source)).toEqual([])
  })

  it('finds comments inside a template expression as well as after a statement', () => {
    const source: string = `const value = \`value: \${/* ${DIRECTIVE} */ 1}\`; // end`
    expect(sourceComments(source).map((comment) => comment.text)).toEqual([
      `/* ${DIRECTIVE} */`,
      '// end',
    ])
  })

  it('reads a final comment after the last statement', () => {
    expect(sourceComments('const value = 1\n// final')).toEqual([{ line: 2, text: '// final' }])
  })
})
