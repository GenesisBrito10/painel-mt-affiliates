export default defineAppConfig({
  ui: {
    colors: {
      primary: 'mtgreen',
      info: 'mtgreen',
      neutral: 'zinc'
    },
    button: {
      defaultVariants: {
        size: 'md'
      }
    },
    card: {
      slots: {
        root: 'rounded-xl'
      }
    }
  }
})
