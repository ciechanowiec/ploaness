import { expect, it } from 'vitest'
import { treeVerify } from '../src/checks/tree.js'
import { createContext } from '../src/context.js'

it('refuses a tree verdict when this run established no snapshot', () => {
  expect(treeVerify(createContext(process.cwd(), true)).ok).toBe(false)
})
