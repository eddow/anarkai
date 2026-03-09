import '@picocss/pico/css/pico.min.css'
import './app.css'
import { profileInfo } from 'mutts'
import { latch } from '@pounce'
import App from './App'
import { initTranslator } from 'ssh/i18n'

latch('#app', <App />)

; (globalThis as typeof globalThis & { ['mutts:profile']?: typeof profileInfo })['mutts:profile'] =
	profileInfo

async function bootstrap() {
	await initTranslator()
}

bootstrap().catch(console.error)
