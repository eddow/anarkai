import './app.css'
import { latch } from '@sursaut/core/dom'
import '@sursaut/kit/dom'
import { initTranslator } from '@app/lib/i18n'
import { profileInfo } from 'mutts'
import { mount } from 'pure-glyf/icons'
import { registerGlyfIconFactory } from 'pure-glyf/sursaut'
import App from './App'

mount()
registerGlyfIconFactory()

;(globalThis as typeof globalThis & { ['mutts:profile']?: typeof profileInfo })['mutts:profile'] =
	profileInfo

latch('#app', <App />)

async function bootstrap() {
	await initTranslator()
}

bootstrap().catch(console.error)
