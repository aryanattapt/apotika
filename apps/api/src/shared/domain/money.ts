/** Currency-independent decimal helpers used by the commerce bounded contexts. */
export function amount(value: string | number) {
  return Number(value).toFixed(2)
}

export function cents(value: string | number) {
  return Math.round(Number(value) * 100)
}

export function money(value: number) {
  return (value / 100).toFixed(2)
}
