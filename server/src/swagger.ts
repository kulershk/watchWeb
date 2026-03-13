export const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Language Learning API',
    version: '1.0.0',
    description: 'API for the Language Learning watch & phone apps. Manages word packs, audio/image assets, user auth, watch sync, ratings, and collaborators.'
  },
  servers: [
    { url: 'https://watch.osrs.lv', description: 'Production' },
    { url: 'http://localhost:3001', description: 'Local development' }
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    },
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          email: { type: 'string' },
          displayName: { type: 'string' },
          friendCode: { type: 'string', example: 'A1B2C3' }
        }
      },
      AuthResponse: {
        type: 'object',
        properties: {
          token: { type: 'string' },
          user: { $ref: '#/components/schemas/User' }
        }
      },
      Word: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
          reading: { type: 'string' },
          audio: { type: 'string', description: 'Audio filename (UUID.ext)' },
          image: { type: 'string', description: 'Image filename (UUID.ext)' }
        },
        required: ['question', 'answer']
      },
      EditWord: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
          reading: { type: 'string' },
          audio: { type: 'string' },
          image: { type: 'string' },
          enabled: { type: 'boolean' }
        },
        required: ['question', 'answer']
      },
      Pack: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          word_count: { type: 'integer' },
          is_public: { type: 'boolean' },
          verification_status: { type: 'string', enum: ['none', 'pending', 'accepted', 'denied', 'neutral'], description: 'Pack verification status' },
          tags: { type: 'string' },
          question_lang: { type: 'string' },
          answer_lang: { type: 'string' },
          download_count: { type: 'integer' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
          is_owner: { type: 'boolean' }
        }
      },
      PublicPack: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          word_count: { type: 'integer' },
          tags: { type: 'string' },
          question_lang: { type: 'string' },
          answer_lang: { type: 'string' },
          download_count: { type: 'integer' },
          verification_status: { type: 'string', enum: ['none', 'pending', 'accepted', 'denied', 'neutral'] },
          updated_at: { type: 'string', format: 'date-time' },
          author: { type: 'string' },
          avg_rating: { type: 'number' },
          rating_count: { type: 'integer' }
        }
      },
      Collaborator: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          displayName: { type: 'string' },
          friendCode: { type: 'string' }
        }
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' }
        }
      }
    }
  },
  paths: {
    // ==================== AUTH ====================
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new account',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8, maxLength: 128, description: 'Must contain uppercase, lowercase, and a number' },
                  displayName: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Registered', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } } },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'Email already registered', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
        }
      }
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login with email and password',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Logged in', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } } },
          '401': { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
        }
      }
    },
    '/api/auth/google': {
      post: {
        tags: ['Auth'],
        summary: 'Login or register with Google',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['idToken'],
                properties: {
                  idToken: { type: 'string', description: 'Google ID token from client' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Authenticated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                    isNewUser: { type: 'boolean', description: 'True if account was just created' },
                    user: { $ref: '#/components/schemas/User' }
                  }
                }
              }
            }
          },
          '401': { description: 'Invalid token', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
        }
      }
    },
    '/api/auth/display-name': {
      put: {
        tags: ['Auth'],
        summary: 'Update display name',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['displayName'],
                properties: {
                  displayName: { type: 'string', maxLength: 100 }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Updated',
            content: { 'application/json': { schema: { type: 'object', properties: { displayName: { type: 'string' } } } } }
          },
          '400': { description: 'Invalid input' }
        }
      }
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get current user info',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': { description: 'User info', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          '401': { description: 'Not authenticated' },
          '404': { description: 'User not found' }
        }
      }
    },

    // ==================== PACKS ====================
    '/api/packs': {
      get: {
        tags: ['Packs'],
        summary: 'List all packs owned by or shared with current user',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'Pack list',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Pack' } } } }
          }
        }
      },
      post: {
        tags: ['Packs'],
        summary: 'Create a new pack',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'words'],
                properties: {
                  name: { type: 'string' },
                  words: { type: 'array', items: { $ref: '#/components/schemas/EditWord' } },
                  is_public: { type: 'boolean' },
                  tags: { type: 'string' },
                  question_lang: { type: 'string' },
                  answer_lang: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Created', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' } } } } } }
        }
      }
    },
    '/api/packs/browse': {
      get: {
        tags: ['Packs'],
        summary: 'Browse public packs',
        description: 'By default returns only verified (accepted) packs. Set verified_only=false to include all public packs except denied ones.',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search by name' },
          { name: 'tag', in: 'query', schema: { type: 'string' }, description: 'Filter by tag' },
          { name: 'question_lang', in: 'query', schema: { type: 'string' }, description: 'Filter by question language' },
          { name: 'answer_lang', in: 'query', schema: { type: 'string' }, description: 'Filter by answer language' },
          { name: 'verified_only', in: 'query', schema: { type: 'string', enum: ['true', 'false'], default: 'true' }, description: 'true = only accepted packs, false = all public except denied' }
        ],
        responses: {
          '200': {
            description: 'Public packs',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/PublicPack' } } } }
          }
        }
      }
    },
    '/api/packs/{id}': {
      put: {
        tags: ['Packs'],
        summary: 'Update a pack (replaces all words)',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'words'],
                properties: {
                  name: { type: 'string' },
                  words: { type: 'array', items: { $ref: '#/components/schemas/EditWord' } },
                  is_public: { type: 'boolean' },
                  tags: { type: 'string' },
                  question_lang: { type: 'string' },
                  answer_lang: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Updated', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } },
          '403': { description: 'Not the owner or collaborator' },
          '404': { description: 'Pack not found' }
        }
      },
      delete: {
        tags: ['Packs'],
        summary: 'Delete a pack and all its words/assets',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Deleted', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } },
          '403': { description: 'Not the owner' },
          '404': { description: 'Pack not found' }
        }
      }
    },
    '/api/packs/{id}/edit': {
      get: {
        tags: ['Packs'],
        summary: 'Get full pack data for editing (includes disabled words)',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': {
            description: 'Pack editor data',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    is_public: { type: 'boolean' },
                    verification_status: { type: 'string', enum: ['none', 'pending', 'accepted', 'denied', 'neutral'] },
                    tags: { type: 'string' },
                    question_lang: { type: 'string' },
                    answer_lang: { type: 'string' },
                    updated_at: { type: 'string', format: 'date-time' },
                    words: { type: 'array', items: { $ref: '#/components/schemas/EditWord' } }
                  }
                }
              }
            }
          },
          '404': { description: 'Pack not found' }
        }
      }
    },

    // ==================== ADMIN VERIFICATION ====================
    '/api/packs/admin/pending': {
      get: {
        tags: ['Admin'],
        summary: 'List public packs filtered by verification status',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'accepted', 'denied', 'neutral', 'all'], default: 'pending' }, description: 'Filter by verification status, or "all" for all public packs' }
        ],
        responses: {
          '200': {
            description: 'Packs list',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/PublicPack' } } } }
          },
          '403': { description: 'Admin access required', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
        }
      }
    },
    '/api/packs/{id}/verify': {
      put: {
        tags: ['Admin'],
        summary: 'Set verification status for a pack (admin only)',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: { type: 'string', enum: ['none', 'pending', 'accepted', 'denied', 'neutral'], description: 'New verification status' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Updated', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } },
          '400': { description: 'Invalid status', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '403': { description: 'Admin access required', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
        }
      }
    },

    // ==================== WORDS (public mobile endpoint) ====================
    '/api/words/{id}': {
      get: {
        tags: ['Packs'],
        summary: 'Get pack for mobile apps (enabled words only)',
        description: 'Public endpoint consumed by watch and phone apps. Tracks downloads per unique authenticated user.',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': {
            description: 'Pack with words',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    updated_at: { type: 'string', format: 'date-time' },
                    question_lang: { type: 'string' },
                    answer_lang: { type: 'string' },
                    author: { type: 'string' },
                    download_count: { type: 'integer' },
                    words: { type: 'array', items: { $ref: '#/components/schemas/Word' } }
                  }
                }
              }
            }
          },
          '404': { description: 'Pack not found' }
        }
      }
    },

    // ==================== RATINGS ====================
    '/api/packs/{id}/rate': {
      post: {
        tags: ['Ratings'],
        summary: 'Rate a pack (1-5)',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['rating'],
                properties: {
                  rating: { type: 'integer', minimum: 1, maximum: 5 }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Rating saved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    avg_rating: { type: 'number' },
                    rating_count: { type: 'integer' },
                    user_rating: { type: 'integer' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/packs/{id}/rating': {
      get: {
        tags: ['Ratings'],
        summary: 'Get rating info for a pack',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': {
            description: 'Rating info',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    avg_rating: { type: 'number' },
                    rating_count: { type: 'integer' },
                    user_rating: { type: 'integer' }
                  }
                }
              }
            }
          }
        }
      }
    },

    // ==================== COLLABORATORS ====================
    '/api/users/lookup/{friendCode}': {
      get: {
        tags: ['Collaborators'],
        summary: 'Look up user by friend code',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'friendCode', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'User found',
            content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' }, displayName: { type: 'string' } } } } }
          },
          '404': { description: 'User not found' }
        }
      }
    },
    '/api/packs/{id}/collaborators': {
      get: {
        tags: ['Collaborators'],
        summary: 'List collaborators for a pack',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': {
            description: 'Collaborator list',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Collaborator' } } } }
          }
        }
      },
      post: {
        tags: ['Collaborators'],
        summary: 'Add a collaborator by friend code',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['friend_code'],
                properties: {
                  friend_code: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Added' },
          '400': { description: 'Cannot add yourself / already a collaborator' },
          '404': { description: 'User or pack not found' }
        }
      }
    },
    '/api/packs/{id}/collaborators/{userId}': {
      delete: {
        tags: ['Collaborators'],
        summary: 'Remove a collaborator',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          { name: 'userId', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        responses: {
          '200': { description: 'Removed' },
          '403': { description: 'Not the owner' }
        }
      }
    },

    // ==================== WATCH SYNC ====================
    '/api/watch/pair-code': {
      post: {
        tags: ['Watch Sync'],
        summary: 'Generate a 6-digit pairing code (phone side)',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'Pairing code',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    code: { type: 'string', example: '482917' },
                    expiresIn: { type: 'integer', example: 300, description: 'Seconds until expiry' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/watch/pair': {
      post: {
        tags: ['Watch Sync'],
        summary: 'Submit pairing code to get sync token (watch side)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['code'],
                properties: {
                  code: { type: 'string', example: '482917' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Paired',
            content: { 'application/json': { schema: { type: 'object', properties: { syncToken: { type: 'string', format: 'uuid' } } } } }
          },
          '404': { description: 'Invalid code' },
          '410': { description: 'Code expired' }
        }
      }
    },
    '/api/watch/sync-packs': {
      put: {
        tags: ['Watch Sync'],
        summary: 'Push enabled pack IDs from phone for watch sync',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['ids'],
                properties: {
                  ids: { type: 'array', items: { type: 'integer' }, description: 'Pack IDs enabled on the phone' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Synced',
            content: { 'application/json': { schema: { type: 'object', properties: { synced: { type: 'integer' } } } } }
          }
        }
      }
    },
    '/api/watch/sync/{syncToken}': {
      get: {
        tags: ['Watch Sync'],
        summary: 'Fetch packs for watch (uses phone-pushed enabled list)',
        parameters: [{ name: 'syncToken', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': {
            description: 'Packs for watch',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    packs: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'integer' },
                          name: { type: 'string' },
                          updated_at: { type: 'string', format: 'date-time' },
                          question_lang: { type: 'string' },
                          answer_lang: { type: 'string' },
                          words: { type: 'array', items: { $ref: '#/components/schemas/Word' } }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          '401': { description: 'Invalid sync token' }
        }
      }
    },

    // ==================== AUDIO ====================
    '/api/audio': {
      post: {
        tags: ['Audio'],
        summary: 'Upload audio file (base64)',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data'],
                properties: {
                  data: { type: 'string', description: 'Data URI (e.g. data:audio/mp4;base64,...)' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Uploaded',
            content: { 'application/json': { schema: { type: 'object', properties: { filename: { type: 'string', example: 'uuid.webm' } } } } }
          }
        }
      }
    },
    '/api/audio/{filename}': {
      get: {
        tags: ['Audio'],
        summary: 'Serve audio file',
        parameters: [{ name: 'filename', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Audio file', content: { 'audio/*': { schema: { type: 'string', format: 'binary' } } } },
          '404': { description: 'Not found' }
        }
      },
      delete: {
        tags: ['Audio'],
        summary: 'Delete audio file',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'filename', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Deleted' }
        }
      }
    },

    // ==================== IMAGES ====================
    '/api/images': {
      post: {
        tags: ['Images'],
        summary: 'Upload image file (base64, max 5MB)',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data'],
                properties: {
                  data: { type: 'string', description: 'Data URI (e.g. data:image/png;base64,...). Supported: png, webp, gif, jpg' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Uploaded',
            content: { 'application/json': { schema: { type: 'object', properties: { filename: { type: 'string', example: 'uuid.png' } } } } }
          },
          '400': { description: 'Invalid format or exceeds 5MB' }
        }
      }
    },
    '/api/images/{filename}': {
      get: {
        tags: ['Images'],
        summary: 'Serve image file',
        parameters: [{ name: 'filename', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Image file', content: { 'image/*': { schema: { type: 'string', format: 'binary' } } } },
          '404': { description: 'Not found' }
        }
      },
      delete: {
        tags: ['Images'],
        summary: 'Delete image file',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'filename', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Deleted' }
        }
      }
    }
  },
  tags: [
    { name: 'Auth', description: 'Registration, login, and user profile' },
    { name: 'Packs', description: 'Word pack CRUD and browsing' },
    { name: 'Admin', description: 'Admin-only pack verification and moderation' },
    { name: 'Ratings', description: 'Pack ratings (1-5 stars)' },
    { name: 'Collaborators', description: 'Pack sharing via friend codes' },
    { name: 'Watch Sync', description: 'Phone-to-watch pairing and pack sync' },
    { name: 'Audio', description: 'Audio file upload and serving' },
    { name: 'Images', description: 'Image file upload and serving' }
  ]
}
