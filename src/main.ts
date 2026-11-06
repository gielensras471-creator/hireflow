import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'

import App from './App.vue'
import pinia from './stores'

import './styles/reset.scss'
import './styles/tokens.scss'
import './styles/global.scss'
import './styles/element.scss'

async function mount() {
  const { default: router } =
    import.meta.env.DEV && import.meta.env.MODE === 'v3-local'
      ? await import('./router/v3')
      : await import('./router')

  createApp(App).use(pinia).use(router).use(ElementPlus).mount('#app')
}

void mount()
