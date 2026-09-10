import { redirect } from 'next/navigation';

/**
 * /admin/ebr · redirect a la tabla de clientes.
 *
 * Aquí vivió el panel de evaluación EBR masiva. Se mudó a `/tabla`, junto a la
 * cartera sobre la que corre y al lado del IPS masivo: una corrida masiva se
 * decide mirando a quién va a alcanzar, no en una pantalla aparte.
 *
 * La página NO se borra. Es la ruta que quedó en marcadores y en enlaces de
 * bitácora; un 404 no diría a dónde se fue el panel.
 */

export const dynamic = 'force-dynamic';

export default function AdminEbr() {
  redirect('/tabla');
}
