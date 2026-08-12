import DefaultTheme from 'vitepress/theme'
import UiComponentDemo from './components/UiComponentDemo.vue'
import './custom.css'
import './components/matrix-renderer-demos.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('UiComponentDemo', UiComponentDemo)
  },
}
