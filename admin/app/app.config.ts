export default defineAppConfig({
  ui: {
    colors: {
      primary: 'gold',
      info: 'violet',
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
