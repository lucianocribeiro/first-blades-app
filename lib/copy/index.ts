// Todos los textos de UI en español (es-AR).
// Ningún componente debe tener strings hardcodeados; siempre importar desde acá.

export const copy = {
  general: {
    loading:   'Cargando...',
    error:     'Ocurrió un error',
    noData:    'Sin datos',
    save:      'Guardar',
    cancel:    'Cancelar',
    edit:      'Editar',
    delete:    'Eliminar',
    confirm:   'Confirmar',
    back:      'Volver',
    search:    'Buscar',
    filter:    'Filtrar',
    create:    'Crear',
    update:    'Actualizar',
    close:     'Cerrar',
    actions:   'Acciones',
    optional:  '(opcional)',
    required:  'Campo requerido',
    yes:       'Sí',
    no:        'No',
  },

  auth: {
    login: {
      welcome:             'Bienvenido',
      subtitle:            'Portal First Blades',
      brandTagline:        'Portal de operaciones de campo',
      email:               'Correo electrónico',
      emailPlaceholder:    'nombre@empresa.com',
      password:            'Contraseña',
      showPassword:        'Mostrar contraseña',
      hidePassword:        'Ocultar contraseña',
      submit:              'Ingresar',
      forgotPassword:      '¿Olvidaste tu contraseña?',
      secureAccess:        'Acceso seguro · First Blades',
      invalidCredentials:  'Correo o contraseña incorrectos.',
      genericError:        'Error al iniciar sesión. Intentá de nuevo.',
    },
    logout: 'Cerrar sesión',
  },

  nav: {
    miPerfil:         'Mi Perfil',
    equipo:           'Equipo',
    calendario:       'Calendario',
    solicitudPasaje:  'Solicitud de Pasaje',
    solicitudAusencia:'Solicitud de Ausencia',
    aprobaciones:     'Aprobaciones',
    procedimientos:   'Procedimientos / Políticas',
    rendicionGastos:  'Rendición de Gastos',
    formularios:      'Formularios',
    gestionUsuarios:  'Gestión de Usuarios',
  },

  placeholder: {
    comingSoon:        'Próximamente',
    comingSoonDesc:    'Este módulo estará disponible próximamente.',
    externalLink:      'Accedé a tu Rendición de Gastos en Google Workspace.',
    externalBtn:       'Abrir en Google Workspace',
    externalPending:   'Enlace pendiente de configuración.',
  },

  status: {
    pendiente:             'Pendiente',
    aprobado:              'Aprobado',
    rechazado:             'Rechazado',
    activo:                'Activo',
    inactivo:              'Inactivo',
    trabajando:            'Trabajando',
    en_viaje:              'En viaje',
    en_franco:             'En franco',
    periodo_fuera_trabajo: 'Fuera del trabajo',
  },

  roles: {
    admin:      'Administrador',
    supervisor: 'Supervisor',
    empleado:   'Empleado',
  },

  purgatorio: {
    infoMessage:      'Tu solicitud será revisada por Administración.',
    pendingMessage:   'Tu solicitud está siendo revisada.',
    approvedMessage:  'Tu solicitud fue aprobada.',
    rejectedMessage:  'Tu solicitud fue rechazada.',
    motivo:           'Motivo del rechazo',
  },

  gestionUsuarios: {
    title:    'Gestión de Usuarios',
    subtitle: 'Administrá los usuarios del portal',
    createUser: 'Crear usuario',
    editUser:   'Editar usuario',
    passwordRequired: 'La contraseña inicial es requerida.',
    table: {
      nombre:      'Nombre',
      email:       'Correo electrónico',
      rol:         'Rol',
      supervisor:  'Supervisor',
      estado:      'Estado',
      ingreso:     'Ingreso',
      acciones:    'Acciones',
    },
    form: {
      nombre:              'Nombre completo',
      nombrePlaceholder:   'Nombre completo',
      email:               'Correo electrónico',
      rol:                 'Rol',
      supervisor:          'Supervisor',
      supervisorPlaceholder: 'Seleccioná un supervisor',
      supervisorHint:      'Solo visible si el rol es Empleado',
      password:            'Contraseña inicial',
      passwordHint:        'El usuario podrá cambiarla después del primer ingreso',
      status:              'Estado',
    },
    messages: {
      createSuccess: 'Usuario creado correctamente.',
      createError:   'Error al crear el usuario.',
      updateSuccess: 'Usuario actualizado correctamente.',
      updateError:   'Error al actualizar el usuario.',
      noUsers:       'No hay usuarios registrados aún.',
      noSupervisors: 'No hay supervisores disponibles.',
    },
    deactivate:   'Desactivar',
    activate:     'Activar',
    confirmDeactivate: '¿Desactivar este usuario?',
  },

  errors: {
    unauthorized:   'No tenés permiso para acceder a esta sección.',
    sessionExpired: 'Tu sesión expiró. Iniciá sesión nuevamente.',
    generic:        'Ocurrió un error inesperado. Intentá nuevamente.',
    notFound:       'Página no encontrada.',
  },

  topbar: {
    notifications: 'Notificaciones',
    userMenu:      'Menú de usuario',
  },

  pages: {
    dashboard: {
      title:       'Inicio',
      subtitle:    'Bienvenido al portal',
      welcome:     'Bienvenido al Portal First Blades',
      loggedAs:    'Ingresaste como',
      hint:        'Seleccioná una opción del menú lateral para comenzar.',
    },
    miPerfil: {
      title:    'Mi Perfil',
      subtitle: 'Tus datos personales y documentos',
    },
    equipo: {
      title:    'Equipo',
      subtitle: 'Integrantes de tu equipo',
    },
    calendario: {
      title:    'Calendario',
      subtitle: 'Calendario de rotación',
    },
    solicitudPasaje: {
      title:    'Solicitud de Pasaje',
      subtitle: 'Gestioná tus pedidos de traslado',
    },
    solicitudAusencia: {
      title:    'Solicitud de Ausencia',
      subtitle: 'Gestioná tus pedidos de ausencia',
    },
    aprobaciones: {
      title:    'Aprobaciones',
      subtitle: 'Bandeja de solicitudes pendientes',
    },
    procedimientos: {
      title:    'Procedimientos / Políticas',
      subtitle: 'Documentos y normativa interna',
    },
    rendicionGastos: {
      title:    'Rendición de Gastos',
      subtitle: 'Acceso externo a Google Workspace',
    },
    formularios: {
      title:    'Formularios',
      subtitle: 'Formularios de ingreso y precarga',
    },
    gestionUsuarios: {
      title:    'Gestión de Usuarios',
      subtitle: 'Administrá los usuarios del portal',
    },
  },
} as const;
