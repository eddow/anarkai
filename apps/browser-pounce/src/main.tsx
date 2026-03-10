import './app.css'
import { profileInfo } from 'mutts'
import { latch } from '@pounce'
import { mount } from 'pure-glyf/icons'
import { registerGlyfIconFactory } from 'pure-glyf/pounce'
import App from './App'
import { initTranslator } from 'ssh/i18n'

mount()
registerGlyfIconFactory()

latch('#app', <App />)

; (globalThis as typeof globalThis & { ['mutts:profile']?: typeof profileInfo })['mutts:profile'] =
	profileInfo

async function bootstrap() {
	await initTranslator()
}

bootstrap().catch(console.error)
