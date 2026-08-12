<template>
  <div class="sdk-live-demo">
    <div ref="host" />
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createRoot } from 'react-dom/client'
import React from 'react'
import ComponentDemo from './ComponentDemo.jsx'

const props = defineProps({
  name: {
    type: String,
    required: true,
  },
})

const host = ref(null)
let root

function renderDemo() {
  if (!root) return
  root.render(React.createElement(ComponentDemo, { name: props.name }))
}

onMounted(() => {
  root = createRoot(host.value)
  renderDemo()
})

watch(() => props.name, renderDemo)

onBeforeUnmount(() => {
  root?.unmount()
  root = undefined
})
</script>
