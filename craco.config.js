module.exports = {
  webpack: {
    configure: (config) => {
      const oneOfRule = config.module.rules.find((rule) => Array.isArray(rule.oneOf))
      if (oneOfRule) {
        oneOfRule.oneOf.forEach((rule) => {
          if (!rule.use) return
          rule.use.forEach((loader) => {
            if (
              typeof loader === 'object' &&
              loader.loader &&
              loader.loader.includes('postcss-loader')
            ) {
              loader.options.postcssOptions.plugins.unshift(
                require('@tailwindcss/postcss')
              )
            }
          })
        })
      }
      return config
    },
  },
}
