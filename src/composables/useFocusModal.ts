import { ref, readonly } from 'vue';

const _modalVisible = ref(false);

export function useFocusModal() {
  function open() {
    _modalVisible.value = true;
  }

  function close() {
    _modalVisible.value = false;
  }

  return {
    visible: readonly(_modalVisible),
    open,
    close,
  };
}
