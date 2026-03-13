import { createRouter, createWebHistory } from 'vue-router'
import Privacy from './views/Privacy.vue'
import AdminVerify from './views/AdminVerify.vue'

const routes = [
  { path: '/', redirect: '/privacy' },
  { path: '/privacy', component: Privacy },
  { path: '/admin', component: AdminVerify },
]

export default createRouter({
  history: createWebHistory(),
  routes,
})
