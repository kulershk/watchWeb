import { createRouter, createWebHistory } from 'vue-router'
import Privacy from './views/Privacy.vue'

const routes = [
  { path: '/', redirect: '/privacy' },
  { path: '/privacy', component: Privacy },
]

export default createRouter({
  history: createWebHistory(),
  routes,
})
