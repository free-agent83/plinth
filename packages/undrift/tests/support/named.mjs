// The roles a no-default-palette message names: the list after its last colon, without the closing sentence
// that offers to propose a role when none fits.
export const named = (message) => {
  const body = message.replace(/ Or propose a role if none fits\.$/, "");
  return body.slice(body.lastIndexOf(": ") + 2).replace(/\.$/, "").split(", ");
};
