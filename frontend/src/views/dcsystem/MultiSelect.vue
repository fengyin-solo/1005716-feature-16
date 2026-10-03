<template>
  <div class="ms" ref="root">
    <button class="ms-trigger btn" type="button" @click="open = !open">
      <span class="ms-title">{{ title }}</span>
      <span class="ms-value" :class="{ placeholder: selected.length === 0 }">
        {{ selected.length === 0 ? placeholder : `已选 ${selected.length} 项` }}
      </span>
      <span class="ms-caret">▾</span>
    </button>
    <div v-if="open" class="ms-panel">
      <div class="ms-tools">
        <button class="link" type="button" @click="selectAll">全选</button>
        <button class="link" type="button" @click="clearAll">清空</button>
      </div>
      <input
        v-if="searchable"
        v-model="keyword"
        class="ms-search"
        type="text"
        placeholder="输入关键字过滤选项"
      />
      <ul class="ms-options">
        <li v-for="option in filteredOptions" :key="option">
          <label class="ms-option">
            <input
              type="checkbox"
              :checked="selected.includes(option)"
              @change="toggle(option)"
            />
            <span>{{ option }}</span>
          </label>
        </li>
        <li v-if="filteredOptions.length === 0" class="ms-empty">没有匹配的选项</li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    title: string
    options: string[]
    modelValue: string[]
    placeholder?: string
    searchable?: boolean
  }>(),
  { placeholder: '全部', searchable: false },
)

const emit = defineEmits<{ (event: 'update:modelValue', value: string[]): void }>()

const open = ref(false)
const keyword = ref('')
const root = ref<HTMLElement | null>(null)

const selected = computed(() => props.modelValue)
const filteredOptions = computed(() => {
  const word = keyword.value.trim()
  if (!word) {
    return props.options
  }
  return props.options.filter((option) => option.includes(word))
})

function toggle(option: string) {
  const next = selected.value.includes(option)
    ? selected.value.filter((item) => item !== option)
    : [...selected.value, option]
  emit('update:modelValue', next)
}

function selectAll() {
  emit('update:modelValue', [...props.options])
}

function clearAll() {
  emit('update:modelValue', [])
}

function onDocumentClick(event: MouseEvent) {
  if (root.value && !root.value.contains(event.target as Node)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))
</script>

<style scoped>
.ms { position: relative; }
.ms-trigger { display: flex; align-items: center; gap: 8px; min-width: 190px; text-align: left; }
.ms-title { font-size: 12px; color: var(--muted); }
.ms-value { font-size: 13px; }
.ms-value.placeholder { color: #9aa6b4; }
.ms-caret { margin-left: auto; color: var(--muted); }
.ms-panel {
  position: absolute; z-index: 20; top: calc(100% + 4px); left: 0;
  width: 240px; max-height: 280px; overflow: auto;
  background: #fff; border: 1px solid var(--border); border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12); padding: 8px;
}
.ms-tools { display: flex; gap: 12px; margin-bottom: 6px; font-size: 12px; }
.ms-search { width: 100%; padding: 4px 8px; margin-bottom: 6px; border: 1px solid var(--border); border-radius: 6px; font-size: 12px; }
.ms-options { list-style: none; margin: 0; padding: 0; max-height: 190px; overflow: auto; }
.ms-option { display: flex; gap: 8px; align-items: center; padding: 4px 2px; font-size: 13px; cursor: pointer; }
.ms-option:hover { background: #f1f5f9; }
.ms-empty { font-size: 12px; color: var(--muted); padding: 6px 2px; }
</style>
