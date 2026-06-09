const tailwindPostcss = require('@tailwindcss/postcss')

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
              const origPlugins = loader.options.postcssOptions.plugins
              // Only apply @tailwindcss/postcss to files that use Tailwind directives
              loader.options.postcssOptions = (loaderContext) => {
                const file = loaderContext.resourcePath || ''
                const isTailwind = file.includes('doc-editor')
                return {
                  plugins: isTailwind
                    ? [tailwindPostcss(), ...origPlugins]
                    : origPlugins,
                }
              }
            }
          })
        })
      }
      config.ignoreWarnings = [
        {
          module: /node_modules/,
          message: /Critical dependency/,
        },
      ];
      return config
    },
  },
}
