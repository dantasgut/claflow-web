// A esfera de vidro das cáusticas e o sol delas (os mesmos números do smoke `caustics`).
/** Raio, IOR e distância focal paraxial (do centro) da esfera de vidro da US5. */
export const CAUSTIC_SPHERE = { radius: 0.2, ior: 1.5, focal: (1.5 * 0.2) / (2 * 0.5) } as const;

/** Iluminância do sol das cenas (lux). */
export const CAUSTIC_SUN = 100;
