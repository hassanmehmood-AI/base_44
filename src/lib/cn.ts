type ClassValue = string | number | null | undefined | false | ClassValue[];

function flatten(input: ClassValue[], out: string[]) {
  for (const item of input) {
    if (!item) continue;
    if (Array.isArray(item)) {
      flatten(item, out);
    } else {
      out.push(String(item));
    }
  }
}

export function cn(...inputs: ClassValue[]) {
  const out: string[] = [];
  flatten(inputs, out);
  return out.join(" ");
}
