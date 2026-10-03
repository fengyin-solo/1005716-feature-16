import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { syncRecheckFromGroups } from './api/dc-service'
import './styles/global.css'

// 异常告警的蓄电池组都应在设备巡视待复查清单里：启动时对一次账，缺哪条补哪条，不重复补
syncRecheckFromGroups()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
