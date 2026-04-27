import './app.css'
import { latch } from '@sursaut/core/dom'
import '@sursaut/kit/dom'
import { profileInfo } from 'mutts'
import { mount } from 'pure-glyf/icons'
import { registerGlyfIconFactory } from 'pure-glyf/sursaut'
import { initTranslator } from '@app/lib/i18n'
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
