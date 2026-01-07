import { createApp } from 'vue'
import './style.scss'
import App from './App.vue'
import { profileInfo } from 'mutts'
import { initTranslator } from '@ssh/lib/i18n'

// Initialize mutts profile global
;(globalThis as any)['mutts:profile'] = profileInfo

async function bootstrap() {
    await initTranslator()
    createApp(App).mount('#app')
}

bootstrap().catch(console.error)
