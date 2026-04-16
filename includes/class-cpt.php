<?php

/**
 * Registers the 3D Configurator custom post type.
 */
class CONFIGURATOR_CPT
{
    public static function init()
    {
        add_action('init', [self::class, 'register']);
    }

    public static function register()
    {
        $labels = [
            'name' => '3D Configurator',
            'singular_name' => '3D Configurator',
            'add_new_item' => 'Add New 3D Configurator',
            'edit_item' => 'Edit 3D Configurator',
        ];

        register_post_type('3d-configurator', [ //the internal WordPress identifier for that content type, post_type = configurator all queries must use configuratoradmin screens are tied to it
            'labels' => $labels,
            'public' => false,
            'show_ui' => true,
            'show_in_menu' => true,
            'supports' => ['title'],
            'menu_icon' => 'dashicons-art',
        ]);
    }
}