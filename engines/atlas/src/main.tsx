import './app.css'
import { latch } from '@sursaut/core/dom'
import '@sursaut/kit/dom'
import App from './App'

latch('#app', <App />)
