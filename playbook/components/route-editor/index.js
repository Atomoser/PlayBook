Component({
  properties: {
    draft: { type: Object, value: null },
    choices: { type: Array, value: [] }
  },
  methods: {
    changeName(event) { this.triggerEvent('namechange', { name: event.detail.value }) },
    add(event) { this.triggerEvent('addpoint', { id: event.currentTarget.dataset.id }) },
    move(event) {
      const { index, step } = event.currentTarget.dataset
      this.triggerEvent('movestop', { index: Number(index), step: Number(step) })
    },
    remove(event) { this.triggerEvent('removestop', { index: Number(event.currentTarget.dataset.index) }) },
    browse() { this.triggerEvent('browsemap') },
    cancel() { this.triggerEvent('cancel') },
    save() { this.triggerEvent('save') }
  }
})
