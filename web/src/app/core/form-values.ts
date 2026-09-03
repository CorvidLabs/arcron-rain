/**
 * Reading a submitted form, including its radio groups.
 *
 * Its own module so a test can exercise the function the page actually calls
 * rather than a copy of it. The create form read fields with
 * `form.elements.namedItem(name)`, which returns a `RadioNodeList` for a
 * group of same-named inputs and an `HTMLInputElement` only for a lone one.
 * The `instanceof HTMLInputElement` check that followed therefore fell
 * through to `''` for every radio group on the page, and the defaults behind
 * them decided instead: every rain opened through the form came out
 * open-gated, SPLIT and ALGO whatever its author picked.
 */

/** The submitted value of `name`, or `''`. Radio groups give the checked one. */
export function fieldValue(form: HTMLFormElement, name: string): string {
  const field = new FormData(form).get(name);
  return typeof field === 'string' ? field : '';
}
