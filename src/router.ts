import { createRouter, createWebHistory } from 'vue-router'
import Home from './views/Home.vue'
import Create from './views/Create.vue'
import Edit from './views/Edit.vue'

const routes = [
  { path: '/', component: Home },
  { path: '/create', component: Create },
  { path: '/edit', component: Edit },
  { path: '/edit/:token', component: Edit },
]

export default createRouter({
  history: createWebHistory(),
  routes,
})
