// A changing template can add/remove fields. Only visible fields participate.
export function visibleFields(fields, values) {
  return fields.filter(field => !field.visibleWhen || field.visibleWhen(values));
}
export function missingField(fields, values) {
  return visibleFields(fields, values).find(field => field.required && !values[field.key]?.trim());
}
export function fieldSummary(field, values) {
  const value = values[field.key] ?? '';
  if (!value.trim()) return '未填写';
  if (field.type === 'password') return '已填写';
  if (field.type === 'select' || field.type === 'multiselect') {
    const options = field.optionsFor?.(values) ?? field.options ?? [];
    return value.split(',').map(id => options.find(option => option.value === id)?.label ?? '已失效，请重新选择').join('、');
  }
  return value;
}
