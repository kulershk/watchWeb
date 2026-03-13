import { createRouter, createWebHistory } from 'vue-router'
import Privacy from './views/Privacy.vue'
import AdminVerify from './views/AdminVerify.vue'
import EditView from './views/Edit.vue'

const routes = [
  { path: '/', redirect: '/privacy' },
  { path: '/privacy', component: Privacy },
  { path: '/admin', component: AdminVerify },
  { path: '/admin/edit/:id', component: EditView },
]

export default createRouter({
  history: createWebHistory(),
  routes,
})
