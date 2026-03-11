import { createRouter, createWebHistory } from 'vue-router'
import Home from './views/Home.vue'
import Create from './views/Create.vue'
import Edit from './views/Edit.vue'
import Packs from './views/Packs.vue'
import Privacy from './views/Privacy.vue'

const routes = [
  { path: '/', component: Home },
  { path: '/create', component: Create },
  { path: '/packs', component: Packs },
  { path: '/edit', component: Edit },
  { path: '/edit/:token', component: Edit },
  { path: '/privacy', component: Privacy },
]

export default createRouter({
  history: createWebHistory(),
  routes,
})
