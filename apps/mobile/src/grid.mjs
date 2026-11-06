/** Width of one of four equal columns inside an already inset container (dp). */
export function fourColumnWidth(width,gutter){
  return Math.max(0,(width-3*gutter)/4);
}
