import './app.css'
import { latch } from '@pounce'
import { profileInfo } from 'mutts'
import { mount } from 'pure-glyf/icons'
import { registerGlyfIconFactory } from 'pure-glyf/pounce'
import { initTranslator } from 'ssh/i18n'
import App from './App'

mount()
registerGlyfIconFactory()

latch('#app', <App />)

;(globalThis as typeof globalThis & { ['mutts:profile']?: typeof profileInfo })['mutts:profile'] =
	profileInfo

async function bootstrap() {
	await initTranslator()
}

bootstrap().catch(console.error)
