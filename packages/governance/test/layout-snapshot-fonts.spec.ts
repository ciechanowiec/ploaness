import { describe, expect, it } from 'vitest'
import { type FontFaceFacts, heldFontFaces } from '../src/layout-snapshot.js'

const face = (family: string, status: string): FontFaceFacts => ({ family, status, weight: '400', style: 'normal' })

describe('the font faces of a page measured twice', () => {
  it('keeps a face loaded that the browser reports unloaded again in the second measurement', () => {
    expect(
      heldFontFaces(
        [face('Onest', 'loaded'), face('Spare', 'unloaded')],
        [face('Onest', 'unloaded'), face('Spare', 'unloaded')],
      ),
    ).toEqual([face('Onest', 'loaded'), face('Spare', 'unloaded')])
  })

  it('takes a face that loaded only by the second measurement as loaded', () => {
    expect(heldFontFaces([face('Onest', 'loading')], [face('Onest', 'loaded')])).toEqual([face('Onest', 'loaded')])
  })

  it('reports a face that failed in the second measurement as failed', () => {
    expect(heldFontFaces([face('Onest', 'loaded')], [face('Onest', 'error')])).toEqual([face('Onest', 'error')])
  })

  it('keeps a face that never loaded unloaded', () => {
    expect(heldFontFaces([face('Onest', 'unloaded')], [face('Onest', 'unloaded')])).toEqual([face('Onest', 'unloaded')])
  })

  it('takes the second set as it is when the faces no longer pair up', () => {
    const second: readonly FontFaceFacts[] = [face('Other', 'unloaded'), face('Onest', 'unloaded')]
    expect(heldFontFaces([face('Onest', 'loaded')], second)).toEqual(second)
    expect(heldFontFaces([face('Onest', 'loaded')], [face('Other', 'unloaded')])).toEqual([face('Other', 'unloaded')])
  })
})
