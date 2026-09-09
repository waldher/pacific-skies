// Available aircraft only. Flight/weapon balance remains in CONFIG.
export const AIRCRAFT = Object.freeze({
  p38: Object.freeze({ id: 'p38', name: 'P-38 Lightning', shortName: 'P-38', role: 'Interceptor', carrierCompatible: false, model: 'P38_Lightning', description: 'Twin-engine fighter · airfields only' }),
  corsair: Object.freeze({ id: 'corsair', name: 'F4U Corsair', shortName: 'Corsair', role: 'Naval fighter', carrierCompatible: true, model: 'F4U_Corsair', description: 'Versatile fighter · carriers and airfields' }),
});
