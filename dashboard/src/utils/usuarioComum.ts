// "Usuário comum", o mesmo critério do layout do app (isAdminUser e compradorKit): não é admin e não é
// comprador avulso (kit, curso ou ferramenta). Esses ficam de fora do quadro "Primeiros passos".
export function usuarioComum(u: { is_admin?: boolean; tem_kit?: boolean; tem_produto_avulso?: boolean } | null | undefined): boolean {
  if (!u) return false;
  return !u.is_admin && !u.tem_kit && !u.tem_produto_avulso;
}
