// One owner for each application JSX accessibility check. The registry records both the native
// checker and the Biome check it replaces, so generating either configuration cannot lose the other.

/** One accessibility guarantee and the options that define its supported markup. */
export interface JsxAccessibilityRule {
  readonly oxlint: string
  readonly biome: string
  readonly options?: Readonly<Record<string, unknown>>
}

/** Application accessibility rules, ported with their established semantic allowances. */
export const JSX_ACCESSIBILITY_RULES: readonly JsxAccessibilityRule[] = [
  {
    oxlint: 'jsx-a11y/alt-text',
    biome: 'useAltText',
  },
  {
    oxlint: 'jsx-a11y/anchor-has-content',
    biome: 'useAnchorContent',
  },
  {
    oxlint: 'jsx-a11y/anchor-is-valid',
    biome: 'useValidAnchor',
  },
  {
    oxlint: 'jsx-a11y/aria-activedescendant-has-tabindex',
    biome: 'useAriaActivedescendantWithTabindex',
  },
  {
    oxlint: 'jsx-a11y/aria-props',
    biome: 'useValidAriaProps',
  },
  {
    oxlint: 'jsx-a11y/aria-proptypes',
    biome: 'useValidAriaValues',
  },
  {
    oxlint: 'jsx-a11y/aria-role',
    biome: 'useValidAriaRole',
  },
  {
    oxlint: 'jsx-a11y/aria-unsupported-elements',
    biome: 'noAriaUnsupportedElements',
  },
  {
    oxlint: 'jsx-a11y/autocomplete-valid',
    biome: 'useValidAutocomplete',
  },
  {
    oxlint: 'jsx-a11y/click-events-have-key-events',
    biome: 'useKeyWithClickEvents',
  },
  {
    oxlint: 'jsx-a11y/heading-has-content',
    biome: 'useHeadingContent',
  },
  {
    oxlint: 'jsx-a11y/html-has-lang',
    biome: 'useHtmlLang',
  },
  {
    oxlint: 'jsx-a11y/iframe-has-title',
    biome: 'useIframeTitle',
  },
  {
    oxlint: 'jsx-a11y/img-redundant-alt',
    biome: 'noRedundantAlt',
  },
  {
    oxlint: 'jsx-a11y/interactive-supports-focus',
    biome: 'useFocusableInteractive',
    options: {
      tabbable: ['button', 'checkbox', 'link', 'searchbox', 'spinbutton', 'switch', 'textbox'],
    },
  },
  {
    oxlint: 'jsx-a11y/label-has-associated-control',
    biome: 'noLabelWithoutControl',
  },
  {
    oxlint: 'jsx-a11y/media-has-caption',
    biome: 'useMediaCaption',
  },
  {
    oxlint: 'jsx-a11y/mouse-events-have-key-events',
    biome: 'useKeyWithMouseEvents',
  },
  {
    oxlint: 'jsx-a11y/no-access-key',
    biome: 'noAccessKey',
  },
  {
    oxlint: 'jsx-a11y/no-autofocus',
    biome: 'noAutofocus',
  },
  {
    oxlint: 'jsx-a11y/no-distracting-elements',
    biome: 'noDistractingElements',
  },
  {
    oxlint: 'jsx-a11y/no-interactive-element-to-noninteractive-role',
    biome: 'noInteractiveElementToNoninteractiveRole',
    options: {
      tr: ['none', 'presentation'],
      canvas: ['img'],
    },
  },
  {
    oxlint: 'jsx-a11y/no-noninteractive-element-interactions',
    biome: 'noNoninteractiveElementInteractions',
    options: {
      handlers: [
        'onClick',
        'onError',
        'onLoad',
        'onMouseDown',
        'onMouseUp',
        'onKeyPress',
        'onKeyDown',
        'onKeyUp',
      ],
      alert: ['onKeyUp', 'onKeyDown', 'onKeyPress'],
      body: ['onError', 'onLoad'],
      dialog: ['onKeyUp', 'onKeyDown', 'onKeyPress'],
      iframe: ['onError', 'onLoad'],
      img: ['onError', 'onLoad'],
    },
  },
  {
    oxlint: 'jsx-a11y/no-noninteractive-element-to-interactive-role',
    biome: 'noNoninteractiveElementToInteractiveRole',
    options: {
      ul: ['listbox', 'menu', 'menubar', 'radiogroup', 'tablist', 'tree', 'treegrid'],
      ol: ['listbox', 'menu', 'menubar', 'radiogroup', 'tablist', 'tree', 'treegrid'],
      li: ['menuitem', 'menuitemradio', 'menuitemcheckbox', 'option', 'row', 'tab', 'treeitem'],
      table: ['grid'],
      td: ['gridcell'],
      fieldset: ['radiogroup', 'presentation'],
    },
  },
  {
    oxlint: 'jsx-a11y/no-noninteractive-tabindex',
    biome: 'noNoninteractiveTabindex',
    options: {
      tags: [],
      roles: ['tabpanel'],
      allowExpressionValues: true,
    },
  },
  {
    oxlint: 'jsx-a11y/no-redundant-roles',
    biome: 'noRedundantRoles',
    options: {
      td: ['gridcell'],
    },
  },
  {
    oxlint: 'jsx-a11y/no-static-element-interactions',
    biome: 'noStaticElementInteractions',
    options: {
      allowExpressionValues: true,
      handlers: ['onClick', 'onMouseDown', 'onMouseUp', 'onKeyPress', 'onKeyDown', 'onKeyUp'],
    },
  },
  {
    oxlint: 'jsx-a11y/role-has-required-aria-props',
    biome: 'useAriaPropsForRole',
  },
  {
    oxlint: 'jsx-a11y/role-supports-aria-props',
    biome: 'useAriaPropsSupportedByRole',
  },
  {
    oxlint: 'jsx-a11y/scope',
    biome: 'noHeaderScope',
  },
  {
    oxlint: 'jsx-a11y/tabindex-no-positive',
    biome: 'noPositiveTabindex',
  },
]

/** The native configuration, independent of anything in the consuming working tree. */
export const oxlintAccessibilityConfig = (): Readonly<Record<string, unknown>> => ({
  plugins: ['jsx-a11y'],
  categories: { correctness: 'off' },
  rules: Object.fromEntries(
    JSX_ACCESSIBILITY_RULES.map((rule: JsxAccessibilityRule): readonly [string, unknown] => [
      rule.oxlint,
      rule.options === undefined ? 'error' : ['error', rule.options],
    ]),
  ),
})

/** The Biome checks whose application JSX responsibility belongs to Oxlint. */
export const replacedBiomeAccessibilityRules = (): Readonly<Record<string, string>> =>
  Object.fromEntries(
    JSX_ACCESSIBILITY_RULES.map((rule: JsxAccessibilityRule): readonly [string, string] => [
      rule.biome,
      'off',
    ]),
  )
