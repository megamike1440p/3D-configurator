<?php
/**
 * Registers Elementor widget for the 3D Configurator.
 */

class CONFIGURATOR_Elementor
{
    public static function init()
    {
        add_action('elementor/widgets/register', [self::class, 'register_widget']);
    }

    public static function register_widget($widgets_manager)
    {
        if (!class_exists('\Elementor\Widget_Base')) {
            return;
        }

        require_once CONFIGURATOR_PATH . 'includes/class-elementor-widget.php';
        $widgets_manager->register(new CONFIGURATOR_Elementor_Widget());
    }
}
