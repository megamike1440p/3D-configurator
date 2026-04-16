<?php
/**
 * Elementor widget
 */
function clc_cfg_register_elementor_widget($widgets_manager)
{
    if (!class_exists('\Elementor\Widget_Base'))
        return;

    class CLC_Elementor_Configurator_Widget extends \Elementor\Widget_Base
    {
        public function get_name()
        {
            return 'configurator_widget';
        }

        public function get_title()
        {
            return 'CL 3D Configurator';
        }

        public function get_icon()
        {
            return 'eicon-gallery-grid';
        }

        public function get_categories()
        {
            return ['general'];
        }

        protected function _register_controls()
        {
            $this->start_controls_section(
                'section_config',
                ['label' => 'Configurator']
            );

            $configs = get_posts([
                'post_type' => 'configurator',
                'posts_per_page' => -1,
                'post_status' => 'publish',
            ]);

            $options = ['' => 'Select a configurator'];
            foreach ($configs as $c) {
                $options[$c->ID] = $c->post_title;
            }

            $this->add_control(
                'configurator_id',
                [
                    'label' => 'Configurator',
                    'type' => \Elementor\Controls_Manager::SELECT,
                    'options' => $options,
                ]
            );

            $this->add_control(
                'show_price',
                [
                    'label' => 'Show Price',
                    'type' => \Elementor\Controls_Manager::SWITCHER,
                    'default' => 'yes',
                ]
            );

            $this->add_control(
                'show_cart',
                [
                    'label' => 'Show Add to Cart Button',
                    'type' => \Elementor\Controls_Manager::SWITCHER,
                    'default' => 'yes',
                ]
            );

            $this->add_control(
                'show_snapshot_button',
                [
                    'label' => 'Show Snapshot Button',
                    'type' => \Elementor\Controls_Manager::SWITCHER,
                    'default' => 'yes',
                ]
            );

            $this->end_controls_section();
        }

        protected function render()
        {
            $settings = $this->get_settings_for_display();
            $id = !empty($settings['configurator_id']) ? intval($settings['configurator_id']) : 0;
            if (!$id) {
                echo '<p>Please select a configurator.</p>';
                return;
            }

            $show_price = $settings['show_price'] === 'yes' ? 'yes' : 'no';
            $show_cart = $settings['show_cart'] === 'yes' ? 'yes' : 'no';
            $show_snapshot = $settings['show_snapshot_button'] === 'yes' ? 'yes' : 'no';

            echo do_shortcode(
                '[cl_configurator id="' . $id . '" show_price="' . $show_price . '" show_cart="' . $show_cart . '" show_snapshot_button="' . $show_snapshot . '"]'
            );
        }
    }

    $widgets_manager->register(new \CLC_Elementor_Configurator_Widget());
}
add_action('elementor/widgets/register', 'clc_cfg_register_elementor_widget');
