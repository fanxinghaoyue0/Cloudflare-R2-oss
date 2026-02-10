<script setup>
defineProps({
  modelValue: Boolean,
  items: {
    type: Array,
    required: true,
  },
});

const emit = defineEmits(["update:modelValue", "click"]);
</script>

<template>
  <div class="menu">
    <Transition name="fade">
      <div
        v-show="modelValue"
        class="menu-modal"
        @click="emit('update:modelValue', false)"
      ></div>
    </Transition>

    <Transition name="fade">
      <div v-show="modelValue" class="menu-content">
        <ul>
          <li
            v-for="(item, index) in items"
            :key="index"
            @click="emit('update:modelValue', false); emit('click', item.text)"
          >
            <span>{{ item.text }}</span>
          </li>
        </ul>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.menu-modal {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.2);
  z-index: 10;
}

.menu-content {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 164px;
  max-width: 220px;
  border-radius: 10px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  background-color: #fff;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
  z-index: 11;
  overflow: hidden;
}

.menu-content li {
  padding: 10px 12px;
  cursor: pointer;
  transition: background-color 0.2s;
  font-size: 13px;
}

.menu-content li:hover {
  background-color: #eef6ff;
}
</style>
