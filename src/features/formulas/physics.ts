/**
 * Formulario de Física escrito para esta app: las ecuaciones estándar de la materia, con lo que
 * significa cada una. No es una copia del cuadernillo oficial del IB, que tiene derechos de autor.
 */

export interface Formula {
  tex: string;
  what: string;
  /** Sólo hace falta en el nivel superior. */
  hl?: boolean;
}

export interface FormulaGroup {
  title: string;
  items: Formula[];
}

export interface FormulaSection {
  id: string;
  title: string;
  groups: FormulaGroup[];
}

export const PHYSICS_FORMULAS: FormulaSection[] = [
  {
    id: 'a',
    title: 'Movimiento y energía',
    groups: [
      {
        title: 'Con aceleración constante',
        items: [
          { tex: String.raw`v = u + at`, what: 'Velocidad tras acelerar durante un tiempo.' },
          { tex: String.raw`s = ut + \tfrac{1}{2}at^2`, what: 'Desplazamiento si no conoces la velocidad final.' },
          { tex: String.raw`s = \tfrac{1}{2}(u + v)\,t`, what: 'Desplazamiento si no conoces la aceleración.' },
          { tex: String.raw`v^2 = u^2 + 2as`, what: 'Cuando el tiempo no aparece en el problema.' },
          { tex: String.raw`u_x = u\cos\theta,\quad u_y = u\sin\theta`, what: 'Componentes de un lanzamiento: en horizontal no acelera y en vertical acelera con g.' },
        ],
      },
      {
        title: 'Fuerzas',
        items: [
          { tex: String.raw`F = ma`, what: 'Segunda ley, con la fuerza neta.' },
          { tex: String.raw`F = \dfrac{\Delta p}{\Delta t},\quad p = mv`, what: 'La fuerza es el ritmo de cambio de la cantidad de movimiento.' },
          { tex: String.raw`J = F\,\Delta t = \Delta p`, what: 'Impulso: área bajo la gráfica fuerza-tiempo.' },
          { tex: String.raw`W = mg`, what: 'Peso.' },
          { tex: String.raw`F_f \le \mu_s F_N,\quad F_f = \mu_d F_N`, what: 'Rozamiento estático, como máximo; y rozamiento dinámico.' },
          { tex: String.raw`F_H = -kx`, what: 'Muelle ideal: la fuerza se opone a la deformación.' },
          { tex: String.raw`F_b = \rho V g`, what: 'Empuje: el peso del fluido desalojado.' },
          { tex: String.raw`F_d = 6\pi\eta r v`, what: 'Arrastre de una esfera lenta en un fluido viscoso.' },
        ],
      },
      {
        title: 'Movimiento circular',
        items: [
          { tex: String.raw`v = \omega r,\quad \omega = \dfrac{2\pi}{T}`, what: 'Rapidez lineal y velocidad angular.' },
          { tex: String.raw`a = \dfrac{v^2}{r} = \omega^2 r = \dfrac{4\pi^2 r}{T^2}`, what: 'Aceleración centrípeta, hacia el centro.' },
          { tex: String.raw`F = \dfrac{mv^2}{r}`, what: 'Fuerza neta necesaria para girar.' },
        ],
      },
      {
        title: 'Trabajo, energía y potencia',
        items: [
          { tex: String.raw`W = Fs\cos\theta`, what: 'Trabajo: sólo cuenta la componente en la dirección del movimiento.' },
          { tex: String.raw`E_k = \tfrac{1}{2}mv^2 = \dfrac{p^2}{2m}`, what: 'Energía cinética.' },
          { tex: String.raw`\Delta E_p = mg\,\Delta h`, what: 'Cambio de energía potencial cerca de la superficie.' },
          { tex: String.raw`E_H = \tfrac{1}{2}k(\Delta x)^2`, what: 'Energía de un muelle deformado.' },
          { tex: String.raw`P = \dfrac{\Delta W}{\Delta t} = Fv`, what: 'Potencia. Con velocidad constante, fuerza por velocidad.' },
          { tex: String.raw`\eta = \dfrac{E_\text{útil}}{E_\text{total}} = \dfrac{P_\text{útil}}{P_\text{total}}`, what: 'Rendimiento.' },
        ],
      },
      {
        title: 'Rotación de sólidos',
        items: [
          { tex: String.raw`\tau = Fr\sin\theta`, what: 'Momento de una fuerza.', hl: true },
          { tex: String.raw`I = \sum mr^2`, what: 'Momento de inercia de un conjunto de masas.', hl: true },
          { tex: String.raw`\tau = I\alpha`, what: 'Segunda ley para la rotación.', hl: true },
          { tex: String.raw`\omega = \omega_0 + \alpha t,\quad \theta = \omega_0 t + \tfrac{1}{2}\alpha t^2`, what: 'Rotación con aceleración angular constante.', hl: true },
          { tex: String.raw`L = I\omega,\quad E_k = \tfrac{1}{2}I\omega^2`, what: 'Momento angular y energía cinética de rotación.', hl: true },
        ],
      },
      {
        title: 'Relatividad',
        items: [
          { tex: String.raw`\gamma = \dfrac{1}{\sqrt{1 - v^2/c^2}}`, what: 'Factor de Lorentz.', hl: true },
          { tex: String.raw`\Delta t = \gamma\,\Delta t_0,\quad L = \dfrac{L_0}{\gamma}`, what: 'Dilatación del tiempo propio y contracción de la longitud propia.', hl: true },
          { tex: String.raw`x' = \gamma(x - vt),\quad t' = \gamma\left(t - \dfrac{vx}{c^2}\right)`, what: 'Transformación entre dos sistemas de referencia.', hl: true },
          { tex: String.raw`u' = \dfrac{u - v}{1 - uv/c^2}`, what: 'Composición de velocidades.', hl: true },
          { tex: String.raw`(ct')^2 - (x')^2 = (ct)^2 - x^2`, what: 'El intervalo no cambia entre sistemas.', hl: true },
        ],
      },
    ],
  },
  {
    id: 'b',
    title: 'Materia, calor y circuitos',
    groups: [
      {
        title: 'Calor',
        items: [
          { tex: String.raw`Q = mc\,\Delta T`, what: 'Energía para cambiar la temperatura.' },
          { tex: String.raw`Q = mL`, what: 'Energía para cambiar de estado, a temperatura constante.' },
          { tex: String.raw`T/\text{K} = \theta/{}^\circ\text{C} + 273`, what: 'De Celsius a Kelvin.' },
          { tex: String.raw`\dfrac{\Delta Q}{\Delta t} = kA\,\dfrac{\Delta T}{\Delta x}`, what: 'Conducción a través de una placa.' },
        ],
      },
      {
        title: 'Radiación y clima',
        items: [
          { tex: String.raw`L = \sigma A T^4`, what: 'Potencia radiada por un cuerpo negro.' },
          { tex: String.raw`\lambda_\text{máx}\,T = 2{,}9\times10^{-3}\,\text{m K}`, what: 'Ley de Wien: cuanto más caliente, menor longitud de onda.' },
          { tex: String.raw`I = \dfrac{L}{4\pi d^2}`, what: 'Intensidad a una distancia d de la fuente.' },
          { tex: String.raw`\text{albedo} = \dfrac{P_\text{reflejada}}{P_\text{incidente}}`, what: 'Fracción de la radiación que se refleja.' },
          { tex: String.raw`P = e\sigma A T^4`, what: 'Cuerpo real: e es la emisividad, entre 0 y 1.' },
        ],
      },
      {
        title: 'Gases',
        items: [
          { tex: String.raw`P = \dfrac{F}{A},\quad \rho = \dfrac{m}{V}`, what: 'Presión y densidad.' },
          { tex: String.raw`n = \dfrac{N}{N_A}`, what: 'Moles a partir del número de partículas.' },
          { tex: String.raw`PV = nRT = Nk_BT`, what: 'Gas ideal, con T en kelvin.' },
          { tex: String.raw`\bar{E}_k = \tfrac{3}{2}k_BT`, what: 'Energía cinética media de una partícula.' },
          { tex: String.raw`U = \tfrac{3}{2}nRT`, what: 'Energía interna de un gas ideal monoatómico.' },
        ],
      },
      {
        title: 'Circuitos',
        items: [
          { tex: String.raw`I = \dfrac{\Delta q}{\Delta t}`, what: 'Corriente: carga por unidad de tiempo.' },
          { tex: String.raw`V = \dfrac{W}{q},\quad R = \dfrac{V}{I}`, what: 'Diferencia de potencial y resistencia.' },
          { tex: String.raw`R = \dfrac{\rho L}{A}`, what: 'Resistencia de un hilo.' },
          { tex: String.raw`P = VI = I^2R = \dfrac{V^2}{R}`, what: 'Potencia disipada.' },
          { tex: String.raw`R_s = R_1 + R_2,\quad \dfrac{1}{R_p} = \dfrac{1}{R_1} + \dfrac{1}{R_2}`, what: 'Resistencias en serie y en paralelo.' },
          { tex: String.raw`\varepsilon = I(R + r)`, what: 'Pila con resistencia interna r.' },
        ],
      },
      {
        title: 'Termodinámica',
        items: [
          { tex: String.raw`Q = \Delta U + W,\quad W = P\,\Delta V`, what: 'Primera ley: W es el trabajo que hace el gas.', hl: true },
          { tex: String.raw`PV^{5/3} = \text{constante}`, what: 'Proceso adiabático de un gas monoatómico.', hl: true },
          { tex: String.raw`\Delta S = \dfrac{\Delta Q}{T},\quad S = k_B\ln\Omega`, what: 'Entropía.', hl: true },
          { tex: String.raw`\eta_\text{Carnot} = 1 - \dfrac{T_c}{T_h}`, what: 'Rendimiento máximo entre dos focos.', hl: true },
        ],
      },
    ],
  },
  {
    id: 'c',
    title: 'Oscilaciones y ondas',
    groups: [
      {
        title: 'Movimiento armónico simple',
        items: [
          { tex: String.raw`T = \dfrac{1}{f},\quad \omega = 2\pi f`, what: 'Periodo, frecuencia y frecuencia angular.' },
          { tex: String.raw`a = -\omega^2 x`, what: 'La condición del MAS: aceleración proporcional y opuesta al desplazamiento.' },
          { tex: String.raw`T = 2\pi\sqrt{\dfrac{m}{k}}`, what: 'Masa en un muelle.' },
          { tex: String.raw`T = 2\pi\sqrt{\dfrac{l}{g}}`, what: 'Péndulo simple, con ángulos pequeños.' },
          { tex: String.raw`x = x_0\sin(\omega t + \phi),\quad v = \omega x_0\cos(\omega t + \phi)`, what: 'Desplazamiento y velocidad en función del tiempo.', hl: true },
          { tex: String.raw`v = \pm\omega\sqrt{x_0^2 - x^2}`, what: 'Velocidad según la posición.', hl: true },
          { tex: String.raw`E_T = \tfrac{1}{2}m\omega^2 x_0^2`, what: 'Energía total de la oscilación.', hl: true },
        ],
      },
      {
        title: 'Ondas',
        items: [
          { tex: String.raw`v = f\lambda`, what: 'Velocidad de una onda.' },
          { tex: String.raw`n_1\sin\theta_1 = n_2\sin\theta_2,\quad n = \dfrac{c}{v}`, what: 'Ley de Snell e índice de refracción.' },
          { tex: String.raw`\sin\theta_c = \dfrac{n_2}{n_1}`, what: 'Ángulo crítico de la reflexión total, con n₁ > n₂.' },
          { tex: String.raw`\Delta = n\lambda,\quad \Delta = \left(n + \tfrac{1}{2}\right)\lambda`, what: 'Diferencia de camino: interferencia constructiva y destructiva, con fuentes en fase.' },
          { tex: String.raw`s = \dfrac{\lambda D}{d}`, what: 'Separación entre franjas con doble rendija.' },
          { tex: String.raw`\theta \approx \dfrac{\lambda}{b}`, what: 'Primer mínimo de difracción por una rendija.', hl: true },
          { tex: String.raw`n\lambda = d\sin\theta`, what: 'Máximos de una red de difracción.', hl: true },
        ],
      },
      {
        title: 'Ondas estacionarias',
        items: [
          { tex: String.raw`f_n = \dfrac{nv}{2L}`, what: 'Cuerda fija por los dos extremos, o tubo abierto por los dos.' },
          { tex: String.raw`f_n = \dfrac{(2n-1)v}{4L}`, what: 'Tubo cerrado por un extremo: sólo armónicos impares.' },
        ],
      },
      {
        title: 'Efecto Doppler',
        items: [
          { tex: String.raw`\dfrac{\Delta\lambda}{\lambda} \approx \dfrac{\Delta f}{f} \approx \dfrac{v}{c}`, what: 'Luz, con velocidades mucho menores que c.' },
          { tex: String.raw`f' = f\,\dfrac{v}{v \pm u_s}`, what: 'Fuente en movimiento: + si se aleja, − si se acerca.', hl: true },
          { tex: String.raw`f' = f\,\dfrac{v \pm u_o}{v}`, what: 'Observador en movimiento: + si se acerca, − si se aleja.', hl: true },
        ],
      },
    ],
  },
  {
    id: 'd',
    title: 'Campos',
    groups: [
      {
        title: 'Gravedad',
        items: [
          { tex: String.raw`F = G\,\dfrac{m_1 m_2}{r^2}`, what: 'Atracción entre dos masas puntuales.' },
          { tex: String.raw`g = \dfrac{F}{m} = \dfrac{GM}{r^2}`, what: 'Intensidad del campo a una distancia r del centro.' },
          { tex: String.raw`\dfrac{T^2}{r^3} = \dfrac{4\pi^2}{GM}`, what: 'Tercera ley de Kepler, en órbita circular.' },
          { tex: String.raw`v_\text{órb} = \sqrt{\dfrac{GM}{r}}`, what: 'Rapidez en órbita circular.' },
          { tex: String.raw`E_p = -\dfrac{GMm}{r},\quad V_g = -\dfrac{GM}{r}`, what: 'Energía y potencial gravitatorios.', hl: true },
          { tex: String.raw`v_\text{esc} = \sqrt{\dfrac{2GM}{r}}`, what: 'Velocidad de escape.', hl: true },
        ],
      },
      {
        title: 'Campo eléctrico',
        items: [
          { tex: String.raw`F = k\,\dfrac{q_1 q_2}{r^2},\quad k = \dfrac{1}{4\pi\varepsilon_0}`, what: 'Ley de Coulomb.' },
          { tex: String.raw`E = \dfrac{F}{q}`, what: 'Intensidad del campo eléctrico.' },
          { tex: String.raw`E = \dfrac{V}{d}`, what: 'Campo uniforme entre dos placas paralelas.' },
          { tex: String.raw`E_p = k\,\dfrac{q_1 q_2}{r},\quad V_e = k\,\dfrac{q}{r}`, what: 'Energía y potencial eléctricos.', hl: true },
        ],
      },
      {
        title: 'Campo magnético',
        items: [
          { tex: String.raw`F = qvB\sin\theta`, what: 'Fuerza sobre una carga en movimiento.' },
          { tex: String.raw`F = BIL\sin\theta`, what: 'Fuerza sobre un conductor con corriente.' },
          { tex: String.raw`r = \dfrac{mv}{qB}`, what: 'Radio de la trayectoria de una carga perpendicular a B.' },
          { tex: String.raw`\Phi = BA\cos\theta`, what: 'Flujo magnético.', hl: true },
          { tex: String.raw`\varepsilon = -N\,\dfrac{\Delta\Phi}{\Delta t}`, what: 'Ley de Faraday-Lenz.', hl: true },
          { tex: String.raw`\varepsilon = BvL`, what: 'Barra que se mueve perpendicular a B.', hl: true },
        ],
      },
    ],
  },
  {
    id: 'e',
    title: 'Física nuclear y cuántica',
    groups: [
      {
        title: 'Núcleo y energía',
        items: [
          { tex: String.raw`E = mc^2`, what: 'Equivalencia entre masa y energía.' },
          { tex: String.raw`\Delta E = hf = \dfrac{hc}{\lambda}`, what: 'Energía de un fotón emitido entre dos niveles.' },
          { tex: String.raw`N = N_0\left(\tfrac{1}{2}\right)^{t/T_{1/2}}`, what: 'Núcleos que quedan tras un tiempo.' },
          { tex: String.raw`A = \lambda N,\quad T_{1/2} = \dfrac{\ln 2}{\lambda}`, what: 'Actividad y semivida.', hl: true },
          { tex: String.raw`N = N_0 e^{-\lambda t}`, what: 'Desintegración, en forma exponencial.', hl: true },
          { tex: String.raw`R = R_0 A^{1/3}`, what: 'Radio aproximado de un núcleo de número másico A.', hl: true },
        ],
      },
      {
        title: 'Estrellas',
        items: [
          { tex: String.raw`d/\text{pc} = \dfrac{1}{p/\text{arcsec}}`, what: 'Distancia a partir de la paralaje.' },
          { tex: String.raw`L = \sigma\,4\pi R^2 T^4`, what: 'Luminosidad de una estrella.' },
          { tex: String.raw`b = \dfrac{L}{4\pi d^2}`, what: 'Brillo aparente.' },
        ],
      },
      {
        title: 'Cuántica',
        items: [
          { tex: String.raw`E_\text{máx} = hf - \Phi`, what: 'Efecto fotoeléctrico.', hl: true },
          { tex: String.raw`\lambda = \dfrac{h}{p}`, what: 'Longitud de onda de De Broglie.', hl: true },
          { tex: String.raw`E = -\dfrac{13{,}6}{n^2}\,\text{eV}`, what: 'Niveles del átomo de hidrógeno.', hl: true },
          { tex: String.raw`mvr = \dfrac{nh}{2\pi}`, what: 'Cuantización en el modelo de Bohr.', hl: true },
        ],
      },
    ],
  },
];

export interface PhysicalConstant {
  name: string;
  tex: string;
}

export const PHYSICAL_CONSTANTS: PhysicalConstant[] = [
  { name: 'Gravedad en la superficie terrestre', tex: String.raw`g = 9{,}8\,\text{m s}^{-2}` },
  { name: 'Constante de gravitación', tex: String.raw`G = 6{,}67\times10^{-11}\,\text{N m}^2\,\text{kg}^{-2}` },
  { name: 'Número de Avogadro', tex: String.raw`N_A = 6{,}02\times10^{23}\,\text{mol}^{-1}` },
  { name: 'Constante de los gases', tex: String.raw`R = 8{,}31\,\text{J K}^{-1}\,\text{mol}^{-1}` },
  { name: 'Constante de Boltzmann', tex: String.raw`k_B = 1{,}38\times10^{-23}\,\text{J K}^{-1}` },
  { name: 'Constante de Stefan-Boltzmann', tex: String.raw`\sigma = 5{,}67\times10^{-8}\,\text{W m}^{-2}\,\text{K}^{-4}` },
  { name: 'Velocidad de la luz en el vacío', tex: String.raw`c = 3{,}00\times10^{8}\,\text{m s}^{-1}` },
  { name: 'Constante de Coulomb', tex: String.raw`k = 8{,}99\times10^{9}\,\text{N m}^2\,\text{C}^{-2}` },
  { name: 'Permitividad del vacío', tex: String.raw`\varepsilon_0 = 8{,}85\times10^{-12}\,\text{C}^2\,\text{N}^{-1}\,\text{m}^{-2}` },
  { name: 'Carga elemental', tex: String.raw`e = 1{,}60\times10^{-19}\,\text{C}` },
  { name: 'Masa del electrón', tex: String.raw`m_e = 9{,}11\times10^{-31}\,\text{kg}` },
  { name: 'Masa del protón', tex: String.raw`m_p = 1{,}67\times10^{-27}\,\text{kg}` },
  { name: 'Constante de Planck', tex: String.raw`h = 6{,}63\times10^{-34}\,\text{J s}` },
  { name: 'Unidad de masa atómica', tex: String.raw`1\,\text{u} = 931{,}5\,\text{MeV}\,c^{-2}` },
  { name: 'Electronvoltio', tex: String.raw`1\,\text{eV} = 1{,}60\times10^{-19}\,\text{J}` },
];

/** El formulario sólo existe para Física. */
export const hasFormulaSheet = (subjectName: string): boolean => /f[ií]sica|physics/i.test(subjectName);
