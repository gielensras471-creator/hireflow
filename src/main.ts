import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'

import App from './App.vue'
import router from './router'
import pinia from './stores'

import './styles/reset.scss'
import './styles/tokens.scss'
import './styles/global.scss'
import './styles/element.scss'

createApp(App).use(pinia).use(router).use(ElementPlus).mount('#app')
